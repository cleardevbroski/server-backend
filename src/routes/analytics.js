const express = require("express");
const { body, query, validationResult } = require("express-validator");
const AnalyticsEvent = require("../models/AnalyticsEvent");
const { ANALYTICS_EVENT_TYPES } = require("../models/AnalyticsEvent");
const Lead = require("../models/Lead");
const Property = require("../models/Property");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");

const router = express.Router();

const META_FIELDS = new Set([
  "propertyId", "propertyTitle", "location", "propertyType", "query", "searchType",
  "lawyerId", "lawyerName", "topic", "source",
]);
const CONVERSION_EVENTS = [
  "brochure_download", "contact_reveal", "enquiry_submitted",
  "whatsapp_consultation_opened",
];

function cleanText(value, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function sanitizeMeta(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => META_FIELDS.has(key))
      .map(([key, value]) => [key, cleanText(value, key === "query" ? 150 : 250)])
      .filter(([, value]) => value),
  );
}

function percentageChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// POST /api/analytics/track (public)
router.post(
  "/track",
  [
    body("eventType").trim().isIn(ANALYTICS_EVENT_TYPES).withMessage("Unsupported analytics event"),
    body("sessionId").optional().trim().matches(/^[a-zA-Z0-9_-]{8,80}$/).withMessage("Invalid analytics session"),
    body("path").optional().trim().isLength({ max: 500 }),
    body("meta").optional().isObject().withMessage("meta must be an object"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }
      await AnalyticsEvent.create({
        eventType: req.body.eventType,
        sessionId: cleanText(req.body.sessionId, 80),
        path: cleanText(req.body.path, 500),
        meta: sanitizeMeta(req.body.meta),
      });
      return res.status(201).json({ message: "Event tracked" });
    } catch (error) {
      console.error("Track event error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// GET /api/analytics/dashboard (admin only)
router.get(
  "/dashboard",
  auth,
  adminOnly,
  [query("days").optional().isIn(["7", "30", "90"]).withMessage("Analytics period must be 7, 30 or 90 days")],
  async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const days = Number(req.query.days || 30);
    const to = new Date();
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - days + 1);
    from.setUTCHours(0, 0, 0, 0);
    const previousFrom = new Date(from);
    previousFrom.setUTCDate(previousFrom.getUTCDate() - days);
    const previousTo = new Date(from.getTime() - 1);
    const currentMatch = { createdAt: { $gte: from, $lte: to } };
    const previousMatch = { createdAt: { $gte: previousFrom, $lte: previousTo } };

    const [
      totalProperties, publishedProperties, totalLeads, previousLeads, totalEvents, previousEvents,
      leadsByStatus, leadsByType, eventCounts, uniqueVisitorsRows, dailyEvents, dailyLeads,
      topProperties, topSearches, propertiesByStatus,
    ] = await Promise.all([
      Property.countDocuments(),
      Property.countDocuments({ $or: [{ published: true }, { status: "published" }] }),
      Lead.countDocuments(currentMatch),
      Lead.countDocuments(previousMatch),
      AnalyticsEvent.countDocuments(currentMatch),
      AnalyticsEvent.countDocuments(previousMatch),
      Lead.aggregate([{ $match: currentMatch }, { $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      Lead.aggregate([{ $match: currentMatch }, { $group: { _id: "$type", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      AnalyticsEvent.aggregate([{ $match: currentMatch }, { $group: { _id: "$eventType", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      AnalyticsEvent.aggregate([{ $match: { ...currentMatch, sessionId: { $ne: "" } } }, { $group: { _id: "$sessionId" } }, { $count: "count" }]),
      AnalyticsEvent.aggregate([{ $match: currentMatch }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      Lead.aggregate([{ $match: currentMatch }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      AnalyticsEvent.aggregate([
        { $match: { ...currentMatch, "meta.propertyId": { $exists: true, $ne: "" } } },
        { $group: {
          _id: "$meta.propertyId",
          title: { $first: "$meta.propertyTitle" },
          location: { $first: "$meta.location" },
          views: { $sum: { $cond: [{ $eq: ["$eventType", "property_view"] }, 1, 0] } },
          interactions: { $sum: 1 },
        } },
        { $sort: { views: -1, interactions: -1 } },
        { $limit: 8 },
      ]),
      AnalyticsEvent.aggregate([
        { $match: { ...currentMatch, eventType: "search", "meta.query": { $exists: true, $ne: "" } } },
        { $group: { _id: { $toLower: "$meta.query" }, query: { $first: "$meta.query" }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 8 },
      ]),
      Property.aggregate([{ $group: { _id: { $ifNull: ["$status", "unclassified"] }, count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    ]);

    const eventMap = new Map(eventCounts.map((item) => [item._id, item.count]));
    const propertyViews = eventMap.get("property_view") || 0;
    const conversionEvents = CONVERSION_EVENTS.reduce((sum, event) => sum + (eventMap.get(event) || 0), 0);
    const eventsByDate = new Map(dailyEvents.map((item) => [item._id, item.count]));
    const leadsByDate = new Map(dailyLeads.map((item) => [item._id, item.count]));
    const trend = Array.from({ length: days }, (_, index) => {
      const date = new Date(from);
      date.setUTCDate(date.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      return { date: key, events: eventsByDate.get(key) || 0, leads: leadsByDate.get(key) || 0 };
    });

    return res.json({
      period: { days, from: from.toISOString(), to: to.toISOString() },
      totalProperties,
      publishedProperties,
      totalLeads,
      totalEvents,
      uniqueVisitors: uniqueVisitorsRows[0]?.count || 0,
      propertyViews,
      conversionEvents,
      conversionRate: propertyViews ? Math.round((conversionEvents / propertyViews) * 1000) / 10 : 0,
      eventGrowth: percentageChange(totalEvents, previousEvents),
      leadGrowth: percentageChange(totalLeads, previousLeads),
      leadsByStatus: leadsByStatus.map((s) => ({ status: s._id, count: s.count })),
      leadsByType: leadsByType.map((item) => ({ type: item._id, count: item.count })),
      eventCounts: eventCounts.map((e) => ({ eventType: e._id, count: e.count })),
      propertiesByStatus: propertiesByStatus.map((item) => ({ status: item._id, count: item.count })),
      trend,
      topProperties: topProperties.map((item) => ({
        propertyId: item._id,
        title: item.title || item._id,
        location: item.location || "",
        views: item.views,
        interactions: item.interactions,
      })),
      topSearches: topSearches.map((item) => ({ query: item.query, count: item.count })),
    });
  } catch (error) {
    console.error("Analytics dashboard error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
