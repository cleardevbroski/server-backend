const express = require("express");
const { body, validationResult } = require("express-validator");
const AnalyticsEvent = require("../models/AnalyticsEvent");
const Lead = require("../models/Lead");
const Property = require("../models/Property");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");

const router = express.Router();

// POST /api/analytics/track (public)
router.post(
  "/track",
  [body("eventType").trim().notEmpty().withMessage("eventType is required")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }
      await AnalyticsEvent.create({
        eventType: req.body.eventType,
        meta: req.body.meta || {},
      });
      return res.status(201).json({ message: "Event tracked" });
    } catch (error) {
      console.error("Track event error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// GET /api/analytics/dashboard (admin only)
router.get("/dashboard", auth, adminOnly, async (req, res) => {
  try {
    const [totalProperties, totalLeads, leadsByStatus, eventCounts] = await Promise.all([
      Property.countDocuments(),
      Lead.countDocuments(),
      Lead.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      AnalyticsEvent.aggregate([{ $group: { _id: "$eventType", count: { $sum: 1 } } }]),
    ]);

    return res.json({
      totalProperties,
      totalLeads,
      leadsByStatus: leadsByStatus.map((s) => ({ status: s._id, count: s.count })),
      eventCounts: eventCounts.map((e) => ({ eventType: e._id, count: e.count })),
    });
  } catch (error) {
    console.error("Analytics dashboard error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
