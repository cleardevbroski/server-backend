const express = require("express");
const { body, validationResult } = require("express-validator");
const rateLimit = require("express-rate-limit");
const Lead = require("../models/Lead");
const Lawyer = require("../models/Lawyer");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");

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
    const { page = 1, limit = 20, type, status, sort = "-createdAt" } = req.query;

    const filter = {};
    if (type) filter.type = String(type);
    if (status) filter.status = String(status);

    const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const skip = (pageNum - 1) * limitNum;

    const [leads, total] = await Promise.all([
      Lead.find(filter).sort(sort).skip(skip).limit(limitNum).lean(),
      Lead.countDocuments(filter),
    ]);

    const mapped = leads.map((l) => ({ ...l, id: l._id.toString() }));

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

// PATCH /api/leads/:id/status (admin only)
router.patch(
  "/:id/status",
  auth,
  adminOnly,
  [body("status").isIn(["new", "contacted", "closed"]).withMessage("Invalid status")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }
      const lead = await Lead.findByIdAndUpdate(
        req.params.id,
        { status: req.body.status },
        { new: true },
      );
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
