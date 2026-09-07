const express = require("express");
const { body, validationResult } = require("express-validator");
const rateLimit = require("express-rate-limit");
const Lead = require("../models/Lead");
const Lawyer = require("../models/Lawyer");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const { buildLeadFilter, clean, enrichLeads, leadSort } = require("../services/leadAdminService");

const router = express.Router();

const leadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many submissions. Please try again later." },
});

// POST /api/leads/contact (public)
router.post(
  "/contact",
  leadLimiter,
  [
    body("name").trim().notEmpty().withMessage("Name is required"),
    body("message").trim().notEmpty().withMessage("Message is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }
      const lead = await Lead.create({
        type: "contact",
        source: "website_contact",
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,
        message: req.body.message,
      });
      return res.status(201).json({
        message: "Thank you, we'll be in touch shortly.",
        lead: { ...lead.toObject(), id: lead._id.toString() },
      });
    } catch (error) {
      console.error("Create contact lead error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// POST /api/leads/consultation (public)
router.post(
  "/consultation",
  leadLimiter,
  [
    body("name").trim().notEmpty().withMessage("Name is required"),
    body("phone").trim().notEmpty().withMessage("Phone is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }
      const lead = await Lead.create({
        type: "consultation",
        source: "legal_consultation",
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,
        message: req.body.message,
        category: req.body.category,
      });
      return res.status(201).json({
        message: "Consultation request received.",
        lead: { ...lead.toObject(), id: lead._id.toString() },
      });
    } catch (error) {
      console.error("Create consultation lead error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// POST /api/leads/consultation/property (Truecaller or manual guest identity)
router.post(
  "/consultation/property",
  auth,
  leadLimiter,
  [
    body("lawyerId").isMongoId().withMessage("Choose a valid lawyer"),
    body("propertyId").trim().notEmpty().withMessage("Property is required"),
    body("propertyTitle").trim().notEmpty().withMessage("Property title is required"),
    body("propertyLocation").optional().trim().isLength({ max: 300 }),
    body("propertyUrl").optional().trim().isLength({ max: 2000 }),
    body("category").trim().notEmpty().isLength({ max: 100 }).withMessage("Choose a consultation topic"),
    body("message").trim().isLength({ min: 10, max: 2000 }).withMessage("Please describe your request in at least 10 characters"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
      if (!req.user.name || !req.user.email) {
        return res.status(400).json({ error: "Complete your name and email before consulting a lawyer" });
      }

      const lawyer = await Lawyer.findOne({ _id: req.body.lawyerId, status: "approved" });
      if (!lawyer) return res.status(404).json({ error: "The selected lawyer is no longer available" });
      if (!lawyer.whatsappNumber) return res.status(409).json({ error: "This lawyer has not enabled WhatsApp consultations" });

      const lead = await Lead.create({
        type: "consultation",
        source: "legal_consultation",
        userId: req.user._id,
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
        message: req.body.message,
        category: req.body.category,
        propertyId: req.body.propertyId,
        propertyTitle: req.body.propertyTitle,
        propertyLocation: req.body.propertyLocation || "",
        propertyUrl: req.body.propertyUrl || "",
        lawyerId: lawyer._id.toString(),
        lawyerName: lawyer.name,
        verificationSource: req.user.verificationSource || "unknown",
        phoneVerified: Boolean(req.user.isVerified),
        consentAt: req.user.consentAt || null,
      });

      let whatsappNumber = String(lawyer.whatsappNumber).replace(/\D/g, "");
      if (whatsappNumber.length === 10) whatsappNumber = `91${whatsappNumber}`;
      const messageLines = [
        `Hello ${lawyer.name},`,
        "I would like a legal consultation through ClearTitle One.",
        "",
        `Property: ${req.body.propertyTitle}`,
        `Property ID: ${req.body.propertyId}`,
        req.body.propertyLocation ? `Location: ${req.body.propertyLocation}` : "",
        req.body.propertyUrl ? `Property link: ${req.body.propertyUrl}` : "",
        `Consultation topic: ${req.body.category}`,
        `Request: ${req.body.message}`,
        "",
        `Customer: ${req.user.name}`,
        `Email: ${req.user.email}`,
        `${req.user.isVerified ? "Verified phone" : "Phone"}: +91 ${req.user.phone}`,
        `ClearTitle request ID: ${lead._id}`,
      ].filter(Boolean);

      return res.status(201).json({
        message: "Consultation request recorded. Continue in WhatsApp to send it to the lawyer.",
        lead: { ...lead.toObject(), id: lead._id.toString() },
        whatsappUrl: `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(messageLines.join("\n"))}`,
      });
    } catch (error) {
      console.error("Create property consultation lead error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// POST /api/leads/property-interest (Truecaller or manual guest identity)
router.post(
  "/property-interest",
  auth,
  leadLimiter,
  [
    body("propertyId").trim().notEmpty().withMessage("Property is required"),
    body("propertyTitle").trim().notEmpty().withMessage("Property title is required"),
    body("audience").isIn(["buyer", "builder"]).withMessage("Choose Buyer or Builder"),
    body("budget").trim().notEmpty().withMessage("Budget is required"),
    body("action").isIn(["brochure", "call", "enquiry"]).withMessage("Invalid property action"),
    body("phone").trim().matches(/^[6-9]\d{9}$/).withMessage("Enter a valid 10-digit Indian mobile number"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
      if (req.body.phone !== req.user.phone) return res.status(403).json({ error: "Use the same phone number saved in your details" });

      const lead = await Lead.create({
        type: "property_interest",
        source: "property_interest",
        userId: req.user._id,
        name: req.user.name || req.body.audience,
        email: req.user.email || "",
        phone: req.user.phone,
        message: `${req.body.action} request for ${req.body.propertyTitle}`,
        propertyId: req.body.propertyId,
        propertyTitle: req.body.propertyTitle,
        audience: req.body.audience,
        budget: req.body.budget,
        action: req.body.action,
        verificationSource: req.user.verificationSource || "unknown",
        phoneVerified: Boolean(req.user.isVerified),
        consentAt: req.user.consentAt || null,
      });
      return res.status(201).json({
        message: "Your request has been received.",
        lead: { ...lead.toObject(), id: lead._id.toString() },
      });
    } catch (error) {
      console.error("Create property-interest lead error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// GET /api/leads (admin only)
router.get("/", auth, adminOnly, async (req, res) => {
  try {
    const filter = buildLeadFilter(req.query);
    const limitNum = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const pageNum = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const skip = (pageNum - 1) * limitNum;

    const [leads, total] = await Promise.all([
      Lead.find(filter).sort(leadSort(clean(req.query.sort, 30))).skip(skip).limit(limitNum).lean(),
      Lead.countDocuments(filter),
    ]);
    const mapped = await enrichLeads(leads);

    return res.json({
      leads: mapped,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("List leads error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/leads/metrics (admin only)
router.get("/metrics", auth, adminOnly, async (req, res) => {
  try {
    const dateFilter = buildLeadFilter({ dateFrom: req.query.dateFrom, dateTo: req.query.dateTo });
    const rows = await Lead.aggregate([
      { $match: dateFilter },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    const counts = Object.fromEntries(rows.map((row) => [row._id, row.count]));
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return res.json({
      total,
      new: counts.new || 0,
      contacted: counts.contacted || 0,
      qualified: counts.qualified || 0,
      closed: counts.closed || 0,
      needsAttention: counts.new || 0,
    });
  } catch (error) {
    console.error("Lead metrics error:", error);
    return res.status(500).json({ error: "Unable to load lead metrics" });
  }
});

// POST /api/leads/import (admin only). The browser parses CSV/XLSX and sends compact rows.
router.post(
  "/import",
  auth,
  adminOnly,
  [body("rows").isArray({ min: 1, max: 2000 }).withMessage("Upload between 1 and 2,000 lead rows")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
      const existingLeads = await Lead.find({
        $or: [{ phone: { $ne: "" } }, { email: { $ne: "" } }],
      }).select("phone email normalizedPhone normalizedEmail").lean();
      const existingPhones = new Set(existingLeads.map((lead) => lead.normalizedPhone || Lead.normalizePhone(lead.phone)).filter(Boolean));
      const existingEmails = new Set(existingLeads.map((lead) => lead.normalizedEmail || String(lead.email || "").trim().toLowerCase()).filter(Boolean));
      const seenPhones = new Set();
      const seenEmails = new Set();
      const accepted = [];
      const rejected = [];

      req.body.rows.forEach((raw, index) => {
        const name = clean(raw?.name, 180);
        const phone = Lead.normalizePhone(raw?.phone);
        const email = clean(raw?.email, 254).toLowerCase();
        const requestedStatus = clean(raw?.status, 30).toLowerCase();
        const status = Lead.STATUSES.includes(requestedStatus) ? requestedStatus : "new";
        if (!name) return rejected.push({ row: index + 2, error: "Name is required" });
        if (!phone && !email) return rejected.push({ row: index + 2, error: "Phone or email is required" });
        if (phone && !/^[6-9]\d{9}$/.test(phone)) return rejected.push({ row: index + 2, error: "Invalid Indian phone number" });
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return rejected.push({ row: index + 2, error: "Invalid email address" });
        if ((phone && (existingPhones.has(phone) || seenPhones.has(phone))) || (email && (existingEmails.has(email) || seenEmails.has(email)))) {
          return rejected.push({ row: index + 2, error: "Duplicate lead" });
        }
        if (phone) seenPhones.add(phone);
        if (email) seenEmails.add(email);
        const propertyTitle = clean(raw?.propertyTitle, 180);
        const requestedType = clean(raw?.type, 30).toLowerCase().replace(/[ -]+/g, "_");
        const type = ["contact", "consultation", "property_interest"].includes(requestedType)
          ? requestedType
          : propertyTitle ? "property_interest" : "contact";
        accepted.push({
          type,
          source: "admin_import",
          name,
          phone,
          email,
          normalizedPhone: phone,
          normalizedEmail: email,
          status,
          message: clean(raw?.message, 2000),
          category: clean(raw?.category, 100),
          propertyId: clean(raw?.propertyId, 100),
          propertyTitle,
          propertyLocation: clean(raw?.propertyLocation, 300),
          budget: clean(raw?.budget, 100),
          audience: ["buyer", "builder"].includes(raw?.audience) ? raw.audience : "",
        });
      });

      if (accepted.length) await Lead.insertMany(accepted, { ordered: false });
      return res.status(201).json({ imported: accepted.length, rejected: rejected.length, errors: rejected.slice(0, 100) });
    } catch (error) {
      console.error("Lead import error:", error);
      return res.status(500).json({ error: "Unable to import leads" });
    }
  },
);

// GET /api/leads/:id (admin only)
router.get("/:id", auth, adminOnly, async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).lean();
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    const [presented] = await enrichLeads([lead]);
    return res.json({ lead: presented });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Lead not found" });
    console.error("Lead detail error:", error);
    return res.status(500).json({ error: "Unable to load lead" });
  }
});

// PATCH /api/leads/:id/status (admin only)
router.patch(
  "/:id/status",
  auth,
  adminOnly,
  [body("status").isIn(Lead.STATUSES).withMessage("Invalid status")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }
      const now = new Date();
      const timestamps = {
        ...(req.body.status === "contacted" ? { lastContactedAt: now } : {}),
        ...(req.body.status === "qualified" ? { qualifiedAt: now } : {}),
        ...(req.body.status === "closed" ? { closedAt: now } : {}),
      };
      const lead = await Lead.findByIdAndUpdate(req.params.id, { status: req.body.status, ...timestamps }, { new: true });
      if (!lead) {
        return res.status(404).json({ error: "Lead not found" });
      }
      return res.json({
        message: "Lead status updated",
        lead: { ...lead.toObject(), id: lead._id.toString() },
      });
    } catch (error) {
      if (error.name === "CastError") {
        return res.status(404).json({ error: "Lead not found" });
      }
      console.error("Update lead status error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PATCH /api/leads/:id/qualification (admin only)
router.patch(
  "/:id/qualification",
  auth,
  adminOnly,
  [
    body("score").isInt({ min: 0, max: 100 }).withMessage("Qualification score must be between 0 and 100"),
    body("level").isIn(Lead.QUALIFICATION_LEVELS).withMessage("Invalid qualification level"),
    body("reasons").optional().isArray({ max: 10 }).withMessage("Qualification reasons must be a list"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
      const reasons = (req.body.reasons || []).map((reason) => clean(reason, 180)).filter(Boolean);
      const lead = await Lead.findByIdAndUpdate(req.params.id, {
        qualificationScore: req.body.score,
        qualificationLevel: req.body.level,
        qualificationReasons: reasons,
      }, { new: true }).lean();
      if (!lead) return res.status(404).json({ error: "Lead not found" });
      const [presented] = await enrichLeads([lead]);
      return res.json({ message: "Qualification updated", lead: presented });
    } catch (error) {
      if (error.name === "CastError") return res.status(404).json({ error: "Lead not found" });
      console.error("Lead qualification error:", error);
      return res.status(500).json({ error: "Unable to update qualification" });
    }
  },
);

// PATCH /api/leads/:id/follow-up (admin only)
router.patch(
  "/:id/follow-up",
  auth,
  adminOnly,
  [body("note").trim().isLength({ min: 1, max: 2000 }).withMessage("Enter a follow-up note"), body("assignedTo").optional().trim().isLength({ max: 120 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
      const note = clean(req.body.note, 2000);
      const lead = await Lead.findByIdAndUpdate(req.params.id, {
        $set: {
          followUpNote: note,
          assignedTo: clean(req.body.assignedTo, 120),
        },
        $push: { followUpHistory: { note, createdBy: req.user._id, createdAt: new Date() } },
      }, { new: true }).lean();
      if (!lead) return res.status(404).json({ error: "Lead not found" });
      const [presented] = await enrichLeads([lead]);
      return res.json({ message: "Follow-up note saved", lead: presented });
    } catch (error) {
      if (error.name === "CastError") return res.status(404).json({ error: "Lead not found" });
      console.error("Lead follow-up error:", error);
      return res.status(500).json({ error: "Unable to save follow-up note" });
    }
  },
);

// DELETE /api/leads/:id (admin only)
router.delete("/:id", auth, adminOnly, async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    return res.json({ message: "Lead deleted successfully" });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Lead not found" });
    console.error("Delete lead error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
