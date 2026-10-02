const express = require("express");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const CPProspect = require("../models/CPProspect");
const CPAdminCampaign = require("../models/CPAdminCampaign");
const CPAdminCampaignRecipient = require("../models/CPAdminCampaignRecipient");

const router = express.Router();
const clean = (value, max = 5000) => String(value ?? "").trim().slice(0, max);
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const internationalPhone = (value) => {
  const digits = clean(value, 40).replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
};
function normalizeAttachment(item) {
  if (!item || typeof item !== "object") return null;
  const title = clean(item.title || item.originalName || "Campaign file", 160);
  const url = clean(item.url, 1000);
  if (!url) return null;
  return { title, url, mimeType: clean(item.mimeType, 100), bytes: Math.max(Number(item.bytes) || 0, 0) };
}

function prospectFilter(query) {
  const filter = { prospectType: "channel_partner" };
  for (const [key, field] of [["state", "address.state"], ["city", "address.city"]]) {
    if (query[key]) filter[field] = new RegExp(`^${escapeRegex(clean(query[key], 100))}$`, "i");
  }
  if (query.area) filter["business.areasOfOperation"] = new RegExp(escapeRegex(clean(query.area, 100)), "i");
  if (query.status) filter.verificationStatus = clean(query.status, 40);
  if (query.search) {
    const search = new RegExp(escapeRegex(clean(query.search, 120)), "i");
    filter.$or = [{ "company.name": search }, { "contact.name": search }, { "contact.mobile": search }, { "contact.whatsappMobile": search }, { "address.city": search }, { "address.state": search }, { "business.areasOfOperation": search }];
  }
  if (query.whatsapp === "yes") filter.$or = [{ "contact.whatsappMobile": { $ne: "" } }, { "contact.mobile": { $ne: "" } }];
  return filter;
}

function presentProspect(item) {
  const phone = item.contact.whatsappMobile || item.contact.mobile || "";
  return {
    id: String(item._id), name: item.contact.name || item.company.name || "Unnamed contact", company: item.company.name || "",
    mobile: item.contact.mobile || "", whatsappMobile: item.contact.whatsappMobile || "", whatsappUrl: phone ? `https://wa.me/${internationalPhone(phone)}` : "",
    city: item.address.city || "", state: item.address.state || "", pincode: item.address.pinCode || "",
    areas: item.business.areasOfOperation || [], status: item.verificationStatus, assignedEmployeeId: item.assignedEmployeeId ? String(item.assignedEmployeeId) : "",
  };
}

router.use(auth, adminOnly);

router.get("/contacts", async (req, res) => {
  try {
    const filter = prospectFilter(req.query);
    if (req.query.idsOnly === "1") {
      const ids = await CPProspect.find(filter).select("_id").sort({ "address.city": 1, "contact.name": 1 }).limit(10000).lean();
      return res.json({ ids: ids.map((item) => String(item._id)), total: ids.length });
    }
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const [items, total, areas, cities, states] = await Promise.all([
      CPProspect.find(filter).sort({ "address.city": 1, "contact.name": 1 }).skip((page - 1) * limit).limit(limit).lean(),
      CPProspect.countDocuments(filter),
      CPProspect.distinct("business.areasOfOperation", { prospectType: "channel_partner", "business.areasOfOperation": { $ne: "" } }),
      CPProspect.distinct("address.city", { prospectType: "channel_partner", "address.city": { $ne: "" } }),
      CPProspect.distinct("address.state", { prospectType: "channel_partner", "address.state": { $ne: "" } }),
    ]);
    return res.json({ contacts: items.map(presentProspect), pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }, areas: areas.sort(), cities: cities.sort(), states: states.sort() });
  } catch (error) { return res.status(500).json({ error: "Unable to load campaign contacts." }); }
});

router.get("/campaigns", async (req, res) => {
  try {
    const campaigns = await CPAdminCampaign.find().sort({ updatedAt: -1 }).limit(100).lean();
    const ids = campaigns.map((item) => item._id);
    const counts = await CPAdminCampaignRecipient.aggregate([{ $match: { campaignId: { $in: ids } } }, { $group: { _id: { campaignId: "$campaignId", status: "$status" }, count: { $sum: 1 } } }]);
    const byCampaign = new Map(); counts.forEach((row) => { const key = String(row._id.campaignId); const current = byCampaign.get(key) || {}; current[row._id.status] = row.count; byCampaign.set(key, current); });
    return res.json({ campaigns: campaigns.map((item) => ({ ...item, id: String(item._id), batches: item.batches.map((batch) => ({ ...batch, id: String(batch._id), recipientCount: batch.recipientIds.length })), counts: byCampaign.get(String(item._id)) || {} })) });
  } catch { return res.status(500).json({ error: "Unable to load admin campaigns." }); }
});

router.post("/campaigns", async (req, res) => {
  try {
    const name = clean(req.body.name, 160);
    const batches = Array.isArray(req.body.batches) ? req.body.batches.slice(0, 4) : [];
    if (!name || !batches.length) return res.status(400).json({ error: "Enter a campaign name and configure at least one batch." });
    const allIds = batches.flatMap((batch) => Array.isArray(batch.recipientIds) ? batch.recipientIds.map(String) : []);
    if (new Set(allIds).size !== allIds.length) return res.status(400).json({ error: "A contact can only appear in one batch." });
    if (allIds.length > 10000) return res.status(400).json({ error: "A campaign can contain no more than 10,000 contacts." });
    const prospects = await CPProspect.find({ _id: { $in: allIds } }).lean();
    const found = new Set(prospects.map((item) => String(item._id)));
    if (found.size !== new Set(allIds).size) return res.status(400).json({ error: "One or more selected contacts no longer exist." });
    const campaign = await CPAdminCampaign.create({ name, filters: req.body.filters || {}, batches: batches.map((batch, index) => ({ name: clean(batch.name, 100) || `Batch ${index + 1}`, senderNumber: clean(batch.senderNumber, 30), message: clean(batch.message, 5000), attachments: (Array.isArray(batch.attachments) ? batch.attachments.slice(0, 20) : []).map(normalizeAttachment).filter(Boolean), recipientIds: batch.recipientIds })), createdBy: req.user._id, updatedBy: req.user._id });
    const prospectMap = new Map(prospects.map((item) => [String(item._id), item]));
    const recipientRows = campaign.batches.flatMap((batch) => batch.recipientIds.map((prospectId) => {
      const prospect = prospectMap.get(String(prospectId));
      return { campaignId: campaign._id, batchId: batch._id, prospectId, message: batch.message, attachments: batch.attachments, senderNumber: batch.senderNumber, status: prospect?.verificationStatus === "do_not_contact" ? "skipped" : "pending", failureReason: prospect?.verificationStatus === "do_not_contact" ? "Contact is marked do not contact." : "" };
    }));
    if (recipientRows.length) await CPAdminCampaignRecipient.insertMany(recipientRows, { ordered: false });
    return res.status(201).json({ campaign: { ...campaign.toObject(), id: String(campaign._id) }, recipientCount: recipientRows.length });
  } catch (error) { return res.status(error.name === "ValidationError" ? 400 : 500).json({ error: error.message || "Unable to save campaign draft." }); }
});

router.get("/campaigns/:id", async (req, res) => {
  try {
    const campaign = await CPAdminCampaign.findById(req.params.id).lean();
    if (!campaign) return res.status(404).json({ error: "Campaign not found." });
    const recipients = await CPAdminCampaignRecipient.find({ campaignId: campaign._id }).populate("prospectId", "contact company address business verificationStatus").sort({ createdAt: 1 }).lean();
    return res.json({ campaign: { ...campaign, id: String(campaign._id), batches: campaign.batches.map((batch) => ({ ...batch, id: String(batch._id) })) }, recipients: recipients.map((row) => ({ ...row, id: String(row._id), campaignId: String(row.campaignId), batchId: String(row.batchId), prospectId: row.prospectId ? presentProspect(row.prospectId) : null })) });
  } catch (error) { return res.status(error.name === "CastError" ? 404 : 500).json({ error: "Unable to load campaign." }); }
});

router.patch("/campaigns/:id/recipients/:recipientId", async (req, res) => {
  try {
    const status = clean(req.body.status, 30);
    if (!["pending", "opened", "sent", "failed", "skipped"].includes(status)) return res.status(400).json({ error: "Invalid campaign status." });
    const update = { status, failureReason: clean(req.body.failureReason, 500) };
    if (status === "opened") update.openedAt = new Date();
    if (status === "sent") update.sentAt = new Date();
    const recipient = await CPAdminCampaignRecipient.findOneAndUpdate({ _id: req.params.recipientId, campaignId: req.params.id }, { $set: update }, { new: true }).lean();
    if (!recipient) return res.status(404).json({ error: "Campaign recipient not found." });
    return res.json({ recipient: { ...recipient, id: String(recipient._id) } });
  } catch (error) { return res.status(error.name === "CastError" ? 404 : 500).json({ error: "Unable to update campaign status." }); }
});

module.exports = router;
