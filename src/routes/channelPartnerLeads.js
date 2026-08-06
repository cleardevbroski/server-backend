const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const ChannelPartner = require("../models/ChannelPartner");
const ChannelPartnerClient = require("../models/ChannelPartnerClient");
const ChannelPartnerCounter = require("../models/ChannelPartnerCounter");
const Property = require("../models/Property");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const { encryptSensitive, decryptSensitive, hashLookup } = require("../utils/channelPartnerCrypto");
const {
  sendChannelPartnerClientRegisteredEmail,
  sendSamePartnerClientDuplicateEmail,
  sendClientClashAttemptEmail,
  sendClientClashOwnerEmail,
} = require("../services/emailService");
const { expireChannelPartnerClients } = require("../services/channelPartnerClientExpiry");

const router = express.Router();
const codeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 1000 : 12, message: { error: "Unable to verify that code. Please try again later." } });
const registerLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 1000 : 30, message: { error: "Too many client registrations. Please try again later." } });
const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const normalizeCode = (value) => clean(value, 30).toUpperCase().replace(/\s+/g, "");
const normalizeMobile = (value) => {
  let digits = clean(value, 30).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  return digits;
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE = /^[6-9][0-9]{9}$/;
const ACTIVE_STATUSES = new Set(["active", "approved"]);
const CLIENT_OWNERSHIP_MS = 90 * 24 * 60 * 60 * 1000;
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function nextLeadNumber() {
  const year = new Date().getFullYear();
  const counter = await ChannelPartnerCounter.findOneAndUpdate(
    { _id: `channel-partner-lead-${year}` },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return `CTL-${year}-${String(counter.sequence).padStart(6, "0")}`;
}

function createPartnerToken(partner) {
  return jwt.sign(
    { purpose: "channel-partner-client-registration", partnerId: partner._id.toString() },
    process.env.JWT_SECRET,
    { expiresIn: process.env.CHANNEL_PARTNER_SESSION_EXPIRY || "4h" },
  );
}

async function partnerSession(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Channel Partner code is required." });
    const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    if (decoded.purpose !== "channel-partner-client-registration" || !decoded.partnerId) return res.status(401).json({ error: "Invalid Channel Partner session." });
    const partner = await ChannelPartner.findById(decoded.partnerId);
    if (!partner || !ACTIVE_STATUSES.has(partner.status)) return res.status(403).json({ error: "This Channel Partner code is not active." });
    req.channelPartner = partner;
    return next();
  } catch (error) {
    return res.status(401).json({ error: error.name === "TokenExpiredError" ? "Channel Partner session expired. Enter the code again." : "Invalid Channel Partner session." });
  }
}

function clientRecord(client) {
  return {
    id: client._id.toString(),
    leadNumber: client.leadNumber,
    clientName: client.clientName,
    mobileMasked: `••••••${client.mobileLast4}`,
    projectId: client.projectId?.toString(),
    projectTitle: client.projectTitle,
    budget: client.budget,
    status: client.status,
    registeredAt: client.registeredAt,
    ownershipExpiresAt: client.ownershipExpiresAt,
  };
}

function adminClientRecord(client) {
  const partner = client.partnerId || {};
  let mobile = "";
  let email = "";
  try { mobile = decryptSensitive(client.mobileEncrypted); } catch { mobile = `••••••${client.mobileLast4}`; }
  try { email = client.emailEncrypted ? decryptSensitive(client.emailEncrypted) : ""; } catch { email = ""; }
  return {
    id: client._id.toString(),
    leadNumber: client.leadNumber,
    clientName: client.clientName,
    mobile,
    email,
    projectTitle: client.projectTitle,
    budget: client.budget,
    status: client.status,
    registeredAt: client.registeredAt,
    ownershipExpiresAt: client.ownershipExpiresAt,
    channelPartner: {
      id: partner._id?.toString() || "",
      name: partner.company?.name || "Channel Partner removed",
      contactName: partner.contact?.name || "",
      mobile: partner.contact?.mobile || "",
      email: partner.contact?.email || "",
      applicationNumber: partner.applicationNumber || "",
      codeLast4: partner.partnerCodeLast4 || "",
    },
  };
}

function duplicateEmailDetails(existing) {
  return {
    clientName: existing.clientName,
    mobileLast4: existing.mobileLast4,
    projectTitle: existing.projectTitle,
    ownershipExpiresAt: existing.ownershipExpiresAt,
  };
}

async function notifyClientClash(existing, attemptingPartner, details) {
  const owningPartner = await ChannelPartner.findById(existing.partnerId).select("company.name contact.email").lean();
  const notifications = [sendClientClashAttemptEmail({
    email: attemptingPartner.contact.email,
    partnerName: attemptingPartner.company.name,
    ...details,
  })];
  if (owningPartner?.contact?.email) notifications.push(sendClientClashOwnerEmail({
    email: owningPartner.contact.email,
    partnerName: owningPartner.company?.name,
    leadNumber: existing.leadNumber,
    ...details,
  }));
  const results = await Promise.allSettled(notifications);
  results.filter(({ status }) => status === "rejected").forEach(({ reason }) => {
    console.error("Channel partner duplicate email failed:", reason?.message || reason);
  });
}

async function notifyActiveDuplicate({ existing, attemptingPartner }) {
  const details = duplicateEmailDetails(existing);
  if (existing.partnerId.equals(attemptingPartner._id)) {
    await sendSamePartnerClientDuplicateEmail({
      email: attemptingPartner.contact.email,
      partnerName: attemptingPartner.company.name,
      leadNumber: existing.leadNumber,
      registeredAt: existing.registeredAt,
      ...details,
    });
    return;
  }
  await notifyClientClash(existing, attemptingPartner, details);
}

async function safelyNotifyActiveDuplicate(details) {
  try {
    await notifyActiveDuplicate(details);
  } catch (emailError) {
    console.error("Channel partner duplicate email failed:", emailError.message);
  }
}

async function respondToActiveDuplicate(res, existing, attemptingPartner) {
  await safelyNotifyActiveDuplicate({ existing, attemptingPartner });
  if (existing.partnerId.equals(attemptingPartner._id)) {
    return res.status(200).json({ message: "This client is already in your active client list. Your original registration remains active.", existing: true, client: clientRecord(existing) });
  }
  return res.status(409).json({ error: "This client already has an active registration. No new registration was created.", activeUntil: existing.ownershipExpiresAt });
}

router.post("/session", codeLimiter, async (req, res) => {
  try {
    const partnerCode = normalizeCode(req.body?.partnerCode);
    if (!/^CT-[0-9]{4,}$/.test(partnerCode)) return res.status(401).json({ error: "Unable to verify that Channel Partner code." });
    const partner = await ChannelPartner.findOne({ partnerCodeHash: hashLookup(partnerCode, "partner-code") });
    if (!partner || !ACTIVE_STATUSES.has(partner.status)) return res.status(401).json({ error: "Unable to verify that Channel Partner code." });
    return res.json({
      message: "Channel Partner code verified",
      token: createPartnerToken(partner),
      partner: {
        name: partner.company.name,
        type: partner.partnerType,
        code: partnerCode,
        contactName: partner.contact.name,
        mobile: partner.contact.mobile,
        email: partner.contact.email,
        city: partner.address.city,
        state: partner.address.state,
      },
    });
  } catch (error) {
    if (error.code === "ENCRYPTION_NOT_CONFIGURED") return res.status(503).json({ error: "Channel Partner registration is not configured." });
    console.error("Channel partner code session error:", error);
    return res.status(500).json({ error: "Unable to verify that Channel Partner code." });
  }
});

router.get("/projects", partnerSession, async (_req, res) => {
  try {
    const projects = await Property.find({ published: true, status: { $in: ["published", "approved"] }, title: { $ne: "" } })
      .select("title area")
      .sort({ title: 1 })
      .limit(500)
      .lean();
    return res.json({ projects: projects.map((project) => ({ id: project._id.toString(), title: project.title, area: project.area || "" })) });
  } catch (error) {
    console.error("Channel partner projects error:", error);
    return res.status(500).json({ error: "Unable to load projects." });
  }
});

router.get("/mine", partnerSession, async (req, res) => {
  try {
    const now = new Date();
    await expireChannelPartnerClients(now);
    const clients = await ChannelPartnerClient.find({ partnerId: req.channelPartner._id, status: "registered", ownershipExpiresAt: { $gt: now } }).sort({ registeredAt: -1 }).lean();
    return res.json({ clients: clients.map(clientRecord) });
  } catch (error) {
    console.error("Channel partner own clients error:", error);
    return res.status(500).json({ error: "Unable to load registered clients." });
  }
});

router.post("/", registerLimiter, partnerSession, async (req, res) => {
  try {
    const clientName = clean(req.body?.clientName, 140);
    const mobile = normalizeMobile(req.body?.mobile);
    const email = clean(req.body?.email, 180).toLowerCase();
    const projectId = clean(req.body?.projectId, 50);
    const budget = clean(req.body?.budget, 100);
    const notes = clean(req.body?.notes, 1000);
    const errors = [];
    if (clientName.length < 2) errors.push("Client name is required.");
    if (!MOBILE.test(mobile)) errors.push("Enter a valid 10-digit Indian mobile number.");
    if (email && !EMAIL.test(email)) errors.push("Enter a valid email address.");
    if (!mongoose.isValidObjectId(projectId)) errors.push("Choose a valid project.");
    if (req.body?.consentAccepted !== true) errors.push("Client consent confirmation is required.");
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    const project = await Property.findOne({ _id: projectId, published: true, status: { $in: ["published", "approved"] } }).select("title").lean();
    if (!project) return res.status(400).json({ error: "Choose an available project." });

    const idempotencyRaw = clean(req.get("Idempotency-Key"), 160);
    const idempotencyHash = idempotencyRaw ? hashLookup(idempotencyRaw, `partner-lead:${req.channelPartner._id}`) : "";
    if (idempotencyHash) {
      const replay = await ChannelPartnerClient.findOne({ idempotencyHash }).select("+idempotencyHash").lean();
      if (replay) return res.status(200).json({ message: "Client already registered", existing: true, client: clientRecord(replay) });
    }

    const now = new Date();
    const mobileHash = hashLookup(mobile, "partner-client-mobile");
    await ChannelPartnerClient.updateMany(
      { mobileHash, status: "registered", ownershipExpiresAt: { $lte: now } },
      { $set: { status: "expired" } },
    );
    const existing = await ChannelPartnerClient.findOne({ mobileHash, status: "registered", ownershipExpiresAt: { $gt: now } });
    if (existing) return respondToActiveDuplicate(res, existing, req.channelPartner);

    const registeredAt = now;
    const ownershipExpiresAt = new Date(now.getTime() + CLIENT_OWNERSHIP_MS);
    let client;
    try {
      client = await ChannelPartnerClient.create({
        leadNumber: await nextLeadNumber(),
        partnerId: req.channelPartner._id,
        partnerCodeLast4: req.channelPartner.partnerCodeLast4,
        clientName,
        mobileEncrypted: encryptSensitive(mobile),
        mobileHash,
        mobileLast4: mobile.slice(-4),
        emailEncrypted: email ? encryptSensitive(email) : "",
        emailHash: email ? hashLookup(email, "partner-client-email") : "",
        projectId: project._id,
        projectTitle: project.title,
        budget,
        notes,
        consentAcceptedAt: now,
        status: "registered",
        registeredAt,
        ownershipExpiresAt,
        ...(idempotencyHash ? { idempotencyHash } : {}),
      });
    } catch (error) {
      if (error.code === 11000) {
        const concurrentExisting = await ChannelPartnerClient.findOne({ mobileHash, status: "registered", ownershipExpiresAt: { $gt: now } });
        if (concurrentExisting) return respondToActiveDuplicate(res, concurrentExisting, req.channelPartner);
        return res.status(409).json({ error: "This client already has an active registration. No new registration was created." });
      }
      throw error;
    }

    let emailSent = false;
    try {
      const result = await sendChannelPartnerClientRegisteredEmail({
        email: req.channelPartner.contact.email,
        partnerName: req.channelPartner.company.name,
        leadNumber: client.leadNumber,
        clientName,
        mobileLast4: mobile.slice(-4),
        projectTitle: project.title,
        registeredAt,
        ownershipExpiresAt,
      });
      emailSent = Boolean(result.delivered);
    } catch (emailError) {
      console.error("Channel partner client email failed:", emailError.message);
    }
    return res.status(201).json({ message: "Client registered successfully", emailSent, client: clientRecord(client) });
  } catch (error) {
    if (error.code === "ENCRYPTION_NOT_CONFIGURED") return res.status(503).json({ error: "Channel Partner registration is not configured." });
    console.error("Channel partner client registration error:", error);
    return res.status(500).json({ error: "Unable to register client." });
  }
});

router.get("/admin/partners/:partnerId", auth, adminOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.partnerId)) return res.status(404).json({ error: "Channel Partner not found." });
    await expireChannelPartnerClients(new Date());
    const clients = await ChannelPartnerClient.find({ partnerId: req.params.partnerId }).sort({ registeredAt: -1 }).lean();
    return res.json({
      active: clients.filter((client) => client.status === "registered" && client.ownershipExpiresAt > new Date()).map(clientRecord),
      history: clients.filter((client) => client.status !== "registered" || client.ownershipExpiresAt <= new Date()).map(clientRecord),
    });
  } catch (error) {
    console.error("Admin channel partner clients error:", error);
    return res.status(500).json({ error: "Unable to load Channel Partner clients." });
  }
});

router.get("/admin/clients", auth, adminOnly, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const status = clean(req.query.status, 20);
    const searchText = clean(req.query.search, 100);
    const now = new Date();
    await expireChannelPartnerClients(now);
    const filter = {};
    if (["registered", "expired", "cancelled", "converted"].includes(status)) filter.status = status;
    if (searchText) {
      const search = new RegExp(escapeRegex(searchText), "i");
      const partners = await ChannelPartner.find({ $or: [{ "company.name": search }, { "contact.name": search }, { applicationNumber: search }] }).select("_id").lean();
      filter.$or = [
        { leadNumber: search },
        { clientName: search },
        { projectTitle: search },
        ...(partners.length ? [{ partnerId: { $in: partners.map((partner) => partner._id) } }] : []),
      ];
    }
    const [clients, total, counts] = await Promise.all([
      ChannelPartnerClient.find(filter).populate("partnerId", "applicationNumber partnerCodeLast4 company.name contact.name contact.mobile contact.email").select("+mobileEncrypted +emailEncrypted").sort({ registeredAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ChannelPartnerClient.countDocuments(filter),
      ChannelPartnerClient.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);
    return res.json({
      clients: clients.map(adminClientRecord),
      counts: Object.fromEntries(counts.map((item) => [item._id, item.count])),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    console.error("Admin CP clients error:", error);
    return res.status(500).json({ error: "Unable to load CP clients." });
  }
});

router.post("/admin/clients/:id/resend-email", auth, adminOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "CP client not found." });
    const client = await ChannelPartnerClient.findById(req.params.id).populate("partnerId", "company.name contact.email");
    if (!client) return res.status(404).json({ error: "CP client not found." });
    if (!client.partnerId?.contact?.email) return res.status(409).json({ error: "The Channel Partner email address is unavailable." });
    if (client.status !== "registered" || client.ownershipExpiresAt <= new Date()) return res.status(409).json({ error: "Only an active client registration email can be resent." });
    const result = await sendChannelPartnerClientRegisteredEmail({
      email: client.partnerId.contact.email,
      partnerName: client.partnerId.company?.name,
      leadNumber: client.leadNumber,
      clientName: client.clientName,
      mobileLast4: client.mobileLast4,
      projectTitle: client.projectTitle,
      registeredAt: client.registeredAt,
      ownershipExpiresAt: client.ownershipExpiresAt,
    });
    if (!result.delivered) return res.status(503).json({ error: "Email delivery is not configured on the server." });
    return res.json({ message: `Client confirmation email sent to ${client.partnerId.contact.email}` });
  } catch (error) {
    console.error("Resend CP client confirmation email error:", error);
    return res.status(502).json({ error: error.message || "Unable to resend client confirmation email." });
  }
});

module.exports = router;
