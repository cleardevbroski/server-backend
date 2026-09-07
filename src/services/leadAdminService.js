const Lead = require("../models/Lead");
const User = require("../models/User");
const VisitorProfile = require("../models/VisitorProfile");
const PropertyEngagement = require("../models/PropertyEngagement");

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clean = (value, max = 200) => String(value ?? "").trim().slice(0, max);

function sourceForType(type) {
  if (type === "contact") return "website_contact";
  if (type === "consultation") return "legal_consultation";
  if (type === "property_interest") return "property_interest";
  return "manual";
}

function qualificationLevel(score) {
  if (score >= 60) return "high";
  if (score >= 30) return "warm";
  if (score > 0) return "low";
  return "unassessed";
}

function activityReasons(activity) {
  if (!activity) return [];
  const reasons = [];
  if (activity.visitCount > 1) reasons.push(`${activity.visitCount} website visits`);
  if (activity.totalActiveSeconds >= 60) reasons.push(`${Math.max(1, Math.round(activity.totalActiveSeconds / 60))} minutes of active browsing`);
  if (activity.topEngagement?.propertyTitle) reasons.push(`Viewed ${activity.topEngagement.propertyTitle}`);
  if (activity.topEngagement?.actionCount) reasons.push(`${activity.topEngagement.actionCount} recorded property actions`);
  return reasons.slice(0, 4);
}

async function identityMapForLeads(leads) {
  const directUserIds = new Set(leads.map((lead) => lead.userId).filter(Boolean).map(String));
  const phones = [...new Set(leads.filter((lead) => !lead.userId).map((lead) => Lead.normalizePhone(lead.phone)).filter(Boolean))];
  const users = phones.length ? await User.find({ phone: { $in: phones } }).select("_id phone").lean() : [];
  const phoneToUser = new Map(users.map((user) => [user.phone, user._id.toString()]));
  users.forEach((user) => directUserIds.add(user._id.toString()));
  return { userIds: [...directUserIds], phoneToUser };
}

async function activityMapForUsers(userIds) {
  if (!userIds.length) return new Map();
  const visitors = await VisitorProfile.find({ userId: { $in: userIds } }).lean();
  if (!visitors.length) return new Map();
  const engagements = await PropertyEngagement.find({ visitorId: { $in: visitors.map((visitor) => visitor._id) } })
    .sort({ activeSeconds: -1, lastViewedAt: -1 })
    .lean();
  const visitorToUser = new Map(visitors.map((visitor) => [visitor._id.toString(), visitor.userId.toString()]));
  const activityByUser = new Map();
  visitors.forEach((visitor) => {
    const key = visitor.userId.toString();
    const current = activityByUser.get(key) || {
      visitCount: 0,
      totalActiveSeconds: 0,
      totalPropertyViews: 0,
      engagementScore: 0,
      lastActivityAt: null,
      topEngagement: null,
    };
    current.visitCount += visitor.visitCount || 0;
    current.totalActiveSeconds += visitor.totalActiveSeconds || 0;
    current.totalPropertyViews += visitor.totalPropertyViews || 0;
    current.engagementScore += visitor.leadScore || 0;
    if (!current.lastActivityAt || new Date(visitor.lastSeenAt) > new Date(current.lastActivityAt)) current.lastActivityAt = visitor.lastSeenAt;
    activityByUser.set(key, current);
  });
  engagements.forEach((engagement) => {
    const key = visitorToUser.get(engagement.visitorId.toString());
    if (!key) return;
    const current = activityByUser.get(key);
    if (!current.topEngagement || engagement.activeSeconds > current.topEngagement.activeSeconds) current.topEngagement = engagement;
  });
  return activityByUser;
}

function presentActivity(activity) {
  if (!activity) return null;
  const top = activity.topEngagement;
  return {
    visitCount: activity.visitCount,
    totalActiveSeconds: activity.totalActiveSeconds,
    totalPropertyViews: activity.totalPropertyViews,
    engagementScore: Math.min(100, activity.engagementScore),
    lastActivityAt: activity.lastActivityAt,
    topProperty: top ? {
      propertyId: top.propertyId,
      propertyTitle: top.propertyTitle,
      propertyType: top.propertyType,
      location: top.location,
      priceLabel: top.priceLabel,
      viewCount: top.viewCount,
      activeSeconds: top.activeSeconds,
      actionCount: top.actionCount,
      actions: top.actions,
      lastViewedAt: top.lastViewedAt,
    } : null,
  };
}

async function enrichLeads(leads) {
  if (!leads.length) return [];
  const { userIds, phoneToUser } = await identityMapForLeads(leads);
  const activities = await activityMapForUsers(userIds);
  return leads.map((lead) => {
    const userId = lead.userId ? lead.userId.toString() : phoneToUser.get(Lead.normalizePhone(lead.phone));
    const rawActivity = userId ? activities.get(userId) : null;
    const activity = presentActivity(rawActivity);
    const hasManualQualification = lead.qualificationLevel && lead.qualificationLevel !== "unassessed";
    const score = hasManualQualification ? lead.qualificationScore : Math.max(lead.qualificationScore || 0, activity?.engagementScore || 0);
    return {
      ...lead,
      id: lead._id.toString(),
      source: lead.source || sourceForType(lead.type),
      qualificationScore: score,
      qualificationLevel: hasManualQualification ? lead.qualificationLevel : qualificationLevel(score),
      qualificationReasons: lead.qualificationReasons?.length ? lead.qualificationReasons : activityReasons(rawActivity),
      qualificationDerived: !hasManualQualification && Boolean(activity),
      activity,
    };
  });
}

function buildLeadFilter(query) {
  const filter = {};
  const conditions = [];
  const status = clean(query.status, 30);
  const type = clean(query.type, 30);
  const source = clean(query.source, 40);
  const level = clean(query.qualificationLevel, 30);
  if (status && Lead.STATUSES.includes(status)) filter.status = status;
  if (type && ["contact", "consultation", "property_interest"].includes(type)) filter.type = type;
  if (source && Lead.SOURCES.includes(source)) {
    const legacyType = {
      website_contact: "contact",
      legal_consultation: "consultation",
      property_interest: "property_interest",
    }[source];
    conditions.push(legacyType
      ? { $or: [{ source }, { source: { $exists: false }, type: legacyType }] }
      : { source });
  }
  if (level && Lead.QUALIFICATION_LEVELS.includes(level)) filter.qualificationLevel = level;
  if (query.propertyId) filter.propertyId = clean(query.propertyId, 100);
  if (query.propertyTitle) filter.propertyTitle = { $regex: escapeRegex(clean(query.propertyTitle, 180)), $options: "i" };
  if (query.dateFrom || query.dateTo) {
    const createdAt = {};
    const from = query.dateFrom ? new Date(query.dateFrom) : null;
    const to = query.dateTo ? new Date(query.dateTo) : null;
    if (from && !Number.isNaN(from.getTime())) createdAt.$gte = from;
    if (to && !Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      createdAt.$lte = to;
    }
    if (Object.keys(createdAt).length) filter.createdAt = createdAt;
  }
  const search = clean(query.search, 120);
  if (search) {
    const expression = { $regex: escapeRegex(search), $options: "i" };
    const identityExpression = { $regex: escapeRegex(search.replace(/\s+/g, "")), $options: "i" };
    conditions.push({
      $or: ["name", "email", "phone", "propertyTitle", "propertyLocation", "message"].map((field) => ({ [field]: expression }))
        .concat([{ normalizedPhone: identityExpression }, { normalizedEmail: identityExpression }]),
    });
  }
  if (conditions.length) filter.$and = conditions;
  return filter;
}

function leadSort(value) {
  const allowed = {
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    name: { name: 1, createdAt: -1 },
    score: { qualificationScore: -1, createdAt: -1 },
    activity: { updatedAt: -1 },
  };
  return allowed[value] || allowed.newest;
}

module.exports = { buildLeadFilter, clean, enrichLeads, leadSort, sourceForType };
