const express = require("express");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const VisitorProfile = require("../models/VisitorProfile");
const VisitorSession = require("../models/VisitorSession");
const PropertyEngagement = require("../models/PropertyEngagement");
const optionalAuth = require("../middleware/optionalAuth");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const { hashActivityId, activityExpiry, budgetBand, engagementScore } = require("../services/clientActivityService");

const router = express.Router();
const trackerLimiter = rateLimit({ windowMs: 60 * 1000, max: process.env.NODE_ENV === "test" ? 1000 : 120, message: { error: "Too many activity updates." } });
const ID = /^[a-zA-Z0-9_-]{16,100}$/;
const ACTIONS = new Set(["", "brochure", "contact", "enquiry", "share", "whatsapp", "priceList", "floorPlan", "favorite", "unfavorite"]);
const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const clampNumber = (value, minimum, maximum) => Math.min(Math.max(Number(value) || 0, minimum), maximum);

function identity(req) {
  const visitorKey = clean(req.body?.visitorId, 100);
  const visitKey = clean(req.body?.visitId, 100);
  if (!ID.test(visitorKey) || !ID.test(visitKey)) return null;
  return {
    visitorHash: hashActivityId(visitorKey, "visitor"),
    sessionHash: hashActivityId(`${visitorKey}:${visitKey}`, "visit"),
  };
}

async function getVisitor(req, visitorHash, now) {
  const update = {
    $setOnInsert: { visitorHash, firstSeenAt: now },
    $set: { lastSeenAt: now, expiresAt: activityExpiry(now) },
  };
  if (req.user?._id) {
    update.$set.userId = req.user._id;
    update.$set.identifiedAt = now;
  }
  return VisitorProfile.findOneAndUpdate({ visitorHash }, update, { new: true, upsert: true, setDefaultsOnInsert: true });
}

async function recordVisit(req, identityValues) {
  const now = new Date();
  const visitor = await getVisitor(req, identityValues.visitorHash, now);
  const visitNumber = visitor.visitCount + 1;
  const result = await VisitorSession.updateOne(
    { sessionHash: identityValues.sessionHash },
    {
      $setOnInsert: {
        sessionHash: identityValues.sessionHash,
        visitorId: visitor._id,
        visitNumber,
        startedAt: now,
        landingPath: clean(req.body?.path, 500),
        referrer: clean(req.body?.referrer, 500),
        deviceCategory: ["mobile", "tablet", "desktop"].includes(req.body?.deviceCategory) ? req.body.deviceCategory : "unknown",
      },
      $set: { lastActivityAt: now, expiresAt: activityExpiry(now) },
    },
    { upsert: true },
  );
  if (result.upsertedCount) await VisitorProfile.updateOne({ _id: visitor._id }, { $inc: { visitCount: 1 } });
  return visitor;
}

router.post("/visit", trackerLimiter, optionalAuth, async (req, res) => {
  try {
    const identityValues = identity(req);
    if (!identityValues) return res.status(400).json({ error: "Invalid visitor session." });
    const visitor = await recordVisit(req, identityValues);
    return res.status(201).json({ message: "Visit recorded", visitor: { id: visitor._id.toString() } });
  } catch (error) {
    console.error("Client activity visit error:", error);
    return res.status(500).json({ error: "Unable to record visit." });
  }
});

router.post("/engagement", trackerLimiter, optionalAuth, async (req, res) => {
  try {
    const identityValues = identity(req);
    const propertyId = clean(req.body?.propertyId, 100);
    const action = clean(req.body?.action, 20);
    if (!identityValues || !propertyId || !ACTIONS.has(action)) return res.status(400).json({ error: "Invalid activity summary." });
    const now = new Date();
    const activeSeconds = clampNumber(req.body?.activeSeconds, 0, 21600);
    const visitor = await recordVisit(req, identityValues);
    const actionIncrement = action ? { [`actions.${action}`]: 1, actionCount: 1 } : {};
    await Promise.all([
      VisitorProfile.updateOne({ _id: visitor._id }, {
        $inc: { totalActiveSeconds: activeSeconds, totalPropertyViews: activeSeconds > 0 ? 1 : 0, leadScore: engagementScore(activeSeconds, action) },
        $set: { lastSeenAt: now, expiresAt: activityExpiry(now), ...(req.user?._id ? { userId: req.user._id, identifiedAt: now } : {}) },
      }),
      VisitorSession.updateOne({ sessionHash: identityValues.sessionHash }, {
        $inc: { activeSeconds, propertyViewCount: activeSeconds > 0 ? 1 : 0 },
        $set: { lastActivityAt: now, expiresAt: activityExpiry(now) },
      }),
      PropertyEngagement.updateOne(
        { visitorId: visitor._id, propertyId },
        {
          $setOnInsert: { visitorId: visitor._id, propertyId, firstViewedAt: now },
          $set: {
            propertyTitle: clean(req.body?.propertyTitle, 180),
            propertyType: clean(req.body?.propertyType, 80),
            location: clean(req.body?.location, 180),
            priceLabel: clean(req.body?.priceLabel, 100),
            budgetBand: budgetBand(req.body?.priceLabel),
            lastViewedAt: now,
            expiresAt: activityExpiry(now),
          },
          $inc: { activeSeconds, viewCount: activeSeconds > 0 ? 1 : 0, ...actionIncrement },
        },
        { upsert: true },
      ),
    ]);
    return res.status(201).json({ message: "Engagement recorded" });
  } catch (error) {
    console.error("Client activity engagement error:", error);
    return res.status(500).json({ error: "Unable to record engagement." });
  }
});

function visitFilter(value) {
  if (value === "1") return { visitCount: 1 };
  if (value === "2") return { visitCount: 2 };
  if (value === "3") return { visitCount: 3 };
  if (value === "4plus") return { visitCount: { $gte: 4 } };
  return {};
}

router.get("/admin/visitors", auth, adminOnly, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const filter = visitFilter(clean(req.query.visits, 20));
    if (req.query.identity === "identified") filter.userId = { $ne: null };
    if (req.query.identity === "anonymous") filter.userId = null;
    const [visitors, total, counts] = await Promise.all([
      VisitorProfile.find(filter).populate("userId", "name phone email").sort({ lastSeenAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      VisitorProfile.countDocuments(filter),
      VisitorProfile.aggregate([{ $group: { _id: null, total: { $sum: 1 }, identified: { $sum: { $cond: [{ $ne: ["$userId", null] }, 1, 0] } }, one: { $sum: { $cond: [{ $eq: ["$visitCount", 1] }, 1, 0] } }, two: { $sum: { $cond: [{ $eq: ["$visitCount", 2] }, 1, 0] } }, three: { $sum: { $cond: [{ $eq: ["$visitCount", 3] }, 1, 0] } }, fourPlus: { $sum: { $cond: [{ $gte: ["$visitCount", 4] }, 1, 0] } } } }]),
    ]);
    const visitorIds = visitors.map((visitor) => visitor._id);
    const topInterests = await PropertyEngagement.aggregate([
      { $match: { visitorId: { $in: visitorIds } } },
      { $sort: { activeSeconds: -1, lastViewedAt: -1 } },
      { $group: { _id: "$visitorId", propertyTitle: { $first: "$propertyTitle" }, propertyType: { $first: "$propertyType" }, budgetBand: { $first: "$budgetBand" }, location: { $first: "$location" } } },
    ]);
    const interestMap = new Map(topInterests.map((item) => [item._id.toString(), item]));
    return res.json({
      visitors: visitors.map((visitor) => ({
        id: visitor._id.toString(),
        name: visitor.userId?.name || `Anonymous ${visitor._id.toString().slice(-6).toUpperCase()}`,
        phone: visitor.userId?.phone || "",
        email: visitor.userId?.email || "",
        identified: Boolean(visitor.userId),
        visitCount: visitor.visitCount,
        totalActiveSeconds: visitor.totalActiveSeconds,
        totalPropertyViews: visitor.totalPropertyViews,
        leadScore: visitor.leadScore,
        firstSeenAt: visitor.firstSeenAt,
        lastSeenAt: visitor.lastSeenAt,
        interest: interestMap.get(visitor._id.toString()) || {},
      })),
      counts: counts[0] || { total: 0, identified: 0, one: 0, two: 0, three: 0, fourPlus: 0 },
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (error) {
    console.error("Admin client activity list error:", error);
    return res.status(500).json({ error: "Unable to load client activity." });
  }
});

router.get("/admin/visitors/:id", auth, adminOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Visitor not found." });
    const visitor = await VisitorProfile.findById(req.params.id).populate("userId", "name phone email").lean();
    if (!visitor) return res.status(404).json({ error: "Visitor not found." });
    const [sessions, engagements] = await Promise.all([
      VisitorSession.find({ visitorId: visitor._id }).sort({ startedAt: -1 }).limit(50).lean(),
      PropertyEngagement.find({ visitorId: visitor._id }).sort({ activeSeconds: -1, lastViewedAt: -1 }).limit(100).lean(),
    ]);
    return res.json({
      visitor: {
        id: visitor._id.toString(),
        name: visitor.userId?.name || `Anonymous ${visitor._id.toString().slice(-6).toUpperCase()}`,
        phone: visitor.userId?.phone || "",
        email: visitor.userId?.email || "",
        identified: Boolean(visitor.userId),
        visitCount: visitor.visitCount,
        totalActiveSeconds: visitor.totalActiveSeconds,
        totalPropertyViews: visitor.totalPropertyViews,
        leadScore: visitor.leadScore,
        firstSeenAt: visitor.firstSeenAt,
        lastSeenAt: visitor.lastSeenAt,
      },
      sessions: sessions.map((session) => ({ id: session._id.toString(), visitNumber: session.visitNumber, startedAt: session.startedAt, lastActivityAt: session.lastActivityAt, activeSeconds: session.activeSeconds, propertyViewCount: session.propertyViewCount, landingPath: session.landingPath, referrer: session.referrer, deviceCategory: session.deviceCategory })),
      engagements: engagements.map((item) => ({ id: item._id.toString(), propertyId: item.propertyId, propertyTitle: item.propertyTitle, propertyType: item.propertyType, location: item.location, priceLabel: item.priceLabel, budgetBand: item.budgetBand, viewCount: item.viewCount, activeSeconds: item.activeSeconds, actionCount: item.actionCount, actions: item.actions, firstViewedAt: item.firstViewedAt, lastViewedAt: item.lastViewedAt })),
    });
  } catch (error) {
    console.error("Admin client activity detail error:", error);
    return res.status(500).json({ error: "Unable to load visitor details." });
  }
});

module.exports = router;
