const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const ChannelPartner = require("../models/ChannelPartner");
const ChannelPartnerCounter = require("../models/ChannelPartnerCounter");
const ChannelPartnerClient = require("../models/ChannelPartnerClient");
const ChannelPartnerClientClash = require("../models/ChannelPartnerClientClash");
const ChannelPartnerRecovery = require("../models/ChannelPartnerRecovery");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const { buildChannelPartnerPayload } = require("../utils/channelPartnerPayload");
const { encryptSensitive, decryptSensitive, hashLookup } = require("../utils/channelPartnerCrypto");
const { canTransition, transitionRequiresReason } = require("../services/channelPartnerWorkflow");
const { sendChannelPartnerRegisteredEmail, sendChannelPartnerStatusEmail } = require("../services/emailService");
const { createPartnerToken } = require("../services/channelPartnerSession");

const router = express.Router();
const submitLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 1000 : 5, message: { error: "Too many applications. Please try again later." } });

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clean = (value, max = 2000) => String(value ?? "").trim().slice(0, max);
const mask = (value, visible = 4) => value ? `${"•".repeat(Math.max(String(value).length - visible, 4))}${String(value).slice(-visible)}` : "";

async function nextApplicationNumber() {
  const year = new Date().getFullYear();
  const counter = await ChannelPartnerCounter.findOneAndUpdate(
    { _id: `channel-partner-${year}` },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return `CP-${year}-${String(counter.sequence).padStart(6, "0")}`;
}

async function nextPartnerCode() {
  const counter = await ChannelPartnerCounter.findOneAndUpdate(
    { _id: "channel-partner-code" },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return `CT-${String(counter.sequence).padStart(4, "0")}`;
}

function publicReceipt(partner, partnerCode = "") {
  return {
    applicationNumber: partner.applicationNumber,
    partnerCode,
    status: partner.status,
    partnerType: partner.partnerType || "company",
    companyName: partner.company.name,
    submittedAt: partner.submittedAt,
  };
}

function listRecord(partner) {
  return {
    id: partner._id.toString(),
    applicationNumber: partner.applicationNumber,
    partnerCodeLast4: partner.partnerCodeLast4,
    partnerType: partner.partnerType || "company",
    companyName: partner.company.name,
    businessType: partner.company.businessType,
    panMasked: mask(partner.company.panNumber),
    reraNumber: partner.company.reraNumber,
    contactName: partner.contact.name,
    mobile: partner.contact.mobile,
    email: partner.contact.email,
    city: partner.address.city,
    state: partner.address.state,
    accountLast4: partner.bank.accountNumberLast4,
    status: partner.status,
    submittedAt: partner.submittedAt,
    createdAt: partner.createdAt,
  };
}

router.post("/", submitLimiter, async (req, res) => {
  try {
    const idempotencyRaw = clean(req.get("Idempotency-Key"), 160);
    const idempotencyKey = idempotencyRaw ? crypto.createHash("sha256").update(idempotencyRaw).digest("hex") : "";
    if (idempotencyKey) {
      const existing = await ChannelPartner.findOne({ idempotencyKey }).select("+partnerCodeEncrypted");
      if (existing) return res.status(200).json({ message: "Channel partner already registered", token: createPartnerToken(existing), application: publicReceipt(existing, existing.partnerCodeEncrypted ? decryptSensitive(existing.partnerCodeEncrypted) : "") });
    }

    const parsed = buildChannelPartnerPayload(req.body || {});
    if (parsed.errors.length) return res.status(400).json({ error: parsed.errors[0], errors: parsed.errors });
    const duplicate = await ChannelPartner.exists({
      $or: [
        { "company.panNumber": parsed.payload.company.panNumber },
        { "contact.email": parsed.payload.contact.email },
        ...(parsed.payload.company.reraNumber ? [{ "company.reraNumber": parsed.payload.company.reraNumber }] : []),
      ],
      status: { $nin: ["rejected"] },
    });
    if (duplicate) return res.status(409).json({ error: "An active application with these registration details already exists." });

    const [applicationNumber, partnerCode] = await Promise.all([nextApplicationNumber(), nextPartnerCode()]);
    const now = new Date();
    const partner = await ChannelPartner.create({
      ...parsed.payload,
      applicationNumber,
      partnerCodeHash: hashLookup(partnerCode, "partner-code"),
      partnerCodeEncrypted: encryptSensitive(partnerCode),
      partnerCodeLast4: partnerCode.slice(-4),
      activatedAt: now,
      status: "active",
      ...(idempotencyKey ? { idempotencyKey } : {}),
      bank: {
        ...parsed.payload.bank,
        accountNumberEncrypted: encryptSensitive(parsed.accountNumber),
        accountNumberLast4: parsed.accountNumber.slice(-4),
      },
      declaration: { ...parsed.payload.declaration, policyVersion: process.env.CHANNEL_PARTNER_POLICY_VERSION || "2026-08-04", acceptedAt: new Date() },
      reviewHistory: [{ fromStatus: "", toStatus: "active", note: "Registration completed and activated automatically" }],
    });
    let emailSent = false;
    try {
      const result = await sendChannelPartnerRegisteredEmail({ email: partner.contact.email, name: partner.company.name, applicationNumber, partnerCode });
      emailSent = Boolean(result.delivered);
    } catch (emailError) {
      console.error("Channel partner registration email failed:", emailError.message);
    }
    return res.status(201).json({ message: "Channel partner registered successfully", emailSent, token: createPartnerToken(partner), application: publicReceipt(partner, partnerCode) });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.idempotencyKey) {
      const key = crypto.createHash("sha256").update(clean(req.get("Idempotency-Key"), 160)).digest("hex");
      const existing = await ChannelPartner.findOne({ idempotencyKey: key }).select("+partnerCodeEncrypted");
      if (existing) return res.status(200).json({ message: "Channel partner already registered", token: createPartnerToken(existing), application: publicReceipt(existing, existing.partnerCodeEncrypted ? decryptSensitive(existing.partnerCodeEncrypted) : "") });
    }
    if (error.code === "ENCRYPTION_NOT_CONFIGURED") return res.status(503).json({ error: "Application service is not configured" });
    console.error("Create channel partner error:", error);
    return res.status(500).json({ error: "Unable to submit application" });
  }
});

router.get("/", auth, adminOnly, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const filter = {};
    if (req.query.status && req.query.status !== "all") filter.status = clean(req.query.status, 30);
    if (req.query.city) filter["address.city"] = new RegExp(`^${escapeRegex(clean(req.query.city, 100))}$`, "i");
    if (req.query.businessType) filter["company.businessType"] = clean(req.query.businessType, 40);
    if (req.query.search) {
      const search = new RegExp(escapeRegex(clean(req.query.search, 100)), "i");
      filter.$or = [
        { applicationNumber: search }, { "company.name": search }, { "contact.name": search },
        { "contact.email": search }, { "contact.mobile": search }, { "company.reraNumber": search },
      ];
    }
    const [partners, total, counts] = await Promise.all([
      ChannelPartner.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      ChannelPartner.countDocuments(filter),
      ChannelPartner.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);
    return res.json({
      partners: partners.map(listRecord),
      counts: Object.fromEntries(counts.map((item) => [item._id, item.count])),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("List channel partners error:", error);
    return res.status(500).json({ error: "Unable to load channel partners" });
  }
});

router.get("/:id", auth, adminOnly, async (req, res) => {
  try {
    const partner = await ChannelPartner.findById(req.params.id).select("+bank.accountNumberEncrypted +partnerCodeEncrypted").lean();
    if (!partner) return res.status(404).json({ error: "Channel partner application not found" });
    const decryptionWarnings = [];
    let accountNumber = "";
    let partnerCode = "";
    try {
      accountNumber = decryptSensitive(partner.bank?.accountNumberEncrypted);
    } catch (error) {
      decryptionWarnings.push("bankAccount");
      console.error(`Channel partner ${partner.applicationNumber} bank details could not be decrypted:`, error.message);
    }
    try {
      partnerCode = partner.partnerCodeEncrypted ? decryptSensitive(partner.partnerCodeEncrypted) : "";
      if (!partnerCode) decryptionWarnings.push("partnerCode");
    } catch (error) {
      decryptionWarnings.push("partnerCode");
      console.error(`Channel partner ${partner.applicationNumber} code could not be decrypted:`, error.message);
    }
    delete partner.bank.accountNumberEncrypted;
    delete partner.partnerCodeEncrypted;
    delete partner.idempotencyKey;
    return res.json({ partner: { ...partner, partnerCode, sensitiveDataAvailable: decryptionWarnings.length === 0, decryptionWarnings, id: partner._id.toString(), partnerType: partner.partnerType || "company", bank: { ...partner.bank, accountNumber } } });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Channel partner application not found" });
    console.error("Get channel partner error:", error);
    return res.status(500).json({ error: "Unable to load channel partner application" });
  }
});

router.post("/:id/resend-registration-email", auth, adminOnly, async (req, res) => {
  try {
    const partner = await ChannelPartner.findById(req.params.id).select("+partnerCodeEncrypted");
    if (!partner) return res.status(404).json({ error: "Channel partner application not found" });
    let partnerCode;
    try {
      partnerCode = decryptSensitive(partner.partnerCodeEncrypted);
    } catch (error) {
      console.error(`Channel partner ${partner.applicationNumber} registration email could not be resent:`, error.message);
      return res.status(409).json({ error: "The partner code cannot be decrypted. Restore the encryption key used when this application was submitted." });
    }
    const result = await sendChannelPartnerRegisteredEmail({
      email: partner.contact.email,
      name: partner.company.name,
      applicationNumber: partner.applicationNumber,
      partnerCode,
    });
    if (!result.delivered) return res.status(503).json({ error: "Email delivery is not configured on the server" });
    return res.json({ message: `Registration email sent to ${partner.contact.email}` });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Channel partner application not found" });
    console.error("Resend channel partner registration email error:", error);
    return res.status(502).json({ error: error.message || "Unable to send registration email" });
  }
});

router.patch("/:id/status", auth, adminOnly, async (req, res) => {
  try {
    const nextStatus = clean(req.body.status, 30);
    const note = clean(req.body.note, 2000);
    const partner = await ChannelPartner.findById(req.params.id);
    if (!partner) return res.status(404).json({ error: "Channel partner application not found" });
    if (!canTransition(partner.status, nextStatus)) return res.status(409).json({ error: `Cannot move an application from ${partner.status} to ${nextStatus}` });
    if ((transitionRequiresReason(nextStatus) || (partner.status === "rejected" && nextStatus === "under_review")) && !note) return res.status(400).json({ error: "A reason is required for this status" });
    const oldStatus = partner.status;
    partner.status = nextStatus;
    partner.reviewedAt = new Date();
    if (nextStatus === "approved" || nextStatus === "active") partner.approvedAt = new Date();
    if (nextStatus === "rejected") partner.rejectedAt = new Date();
    if (nextStatus === "suspended" || nextStatus === "rejected") partner.sessionVersion = (partner.sessionVersion || 0) + 1;
    partner.reviewHistory.push({ fromStatus: oldStatus, toStatus: nextStatus, note, adminId: req.user._id });
    await partner.save();
    let emailSent = false;
    try {
      const result = await sendChannelPartnerStatusEmail({
        email: partner.contact.email,
        name: partner.company.name,
        applicationNumber: partner.applicationNumber,
        status: nextStatus,
        note,
      });
      emailSent = Boolean(result.delivered);
    } catch (emailError) {
      console.error("Channel partner status email failed:", emailError.message);
    }
    return res.json({ message: "Application status updated", emailSent, partner: listRecord(partner) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Channel partner application not found" });
    console.error("Update channel partner status error:", error);
    return res.status(500).json({ error: "Unable to update application" });
  }
});

router.post("/:id/notes", auth, adminOnly, async (req, res) => {
  try {
    const note = clean(req.body.note, 2000);
    if (!note) return res.status(400).json({ error: "Note is required" });
    const partner = await ChannelPartner.findByIdAndUpdate(
      req.params.id,
      { $push: { internalNotes: { note, adminId: req.user._id, createdAt: new Date() } } },
      { new: true },
    );
    if (!partner) return res.status(404).json({ error: "Channel partner application not found" });
    return res.status(201).json({ message: "Internal note added", notes: partner.internalNotes });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Channel partner application not found" });
    return res.status(500).json({ error: "Unable to add internal note" });
  }
});

router.delete("/:id", auth, adminOnly, async (req, res) => {
  try {
    const partner = await ChannelPartner.findById(req.params.id);
    if (!partner) return res.status(404).json({ error: "Channel partner application not found" });

    const clients = await ChannelPartnerClient.find({ partnerId: partner._id }).select("_id").lean();
    const clientIds = clients.map((client) => client._id);
    const clashConditions = [
      { attemptingPartnerId: partner._id },
      { owningPartnerId: partner._id },
    ];
    if (clientIds.length) clashConditions.push({ owningClientId: { $in: clientIds } });

    const clashResult = await ChannelPartnerClientClash.deleteMany({ $or: clashConditions });
    const clientResult = await ChannelPartnerClient.deleteMany({ partnerId: partner._id });
    await ChannelPartnerRecovery.deleteMany({ partnerId: partner._id });
    await partner.deleteOne();

    return res.json({
      message: "Channel partner deleted successfully. The partner can register again.",
      deleted: {
        partners: 1,
        clients: clientResult.deletedCount || 0,
        clashes: clashResult.deletedCount || 0,
      },
    });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Channel partner application not found" });
    console.error("Delete channel partner error:", error);
    return res.status(500).json({ error: "Unable to delete channel partner" });
  }
});

module.exports = router;
