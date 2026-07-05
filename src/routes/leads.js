const express = require("express");
const { body, validationResult } = require("express-validator");
const rateLimit = require("express-rate-limit");
const Lead = require("../models/Lead");
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

// GET /api/leads (admin only)
router.get("/", auth, adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 20, type, status, sort = "-createdAt" } = req.query;

    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [leads, total] = await Promise.all([
      Lead.find(filter).sort(sort).skip(skip).limit(parseInt(limit)).lean(),
      Lead.countDocuments(filter),
    ]);

    const mapped = leads.map((l) => ({ ...l, id: l._id.toString() }));

    return res.json({
      leads: mapped,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
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
  [body("status").isIn(["pending", "approved", "rejected"]).withMessage("Invalid status")],
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
