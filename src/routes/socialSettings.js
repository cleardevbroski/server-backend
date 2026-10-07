const express = require("express");
const SocialSettings = require("../models/SocialSettings");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");

const router = express.Router();
const ACCOUNT_KEYS = ["instagram", "facebook", "youtube", "linkedin", "twitter", "whatsapp"];

function normalizeAccount(value) {
  const source = value && typeof value === "object" ? value : {};
  const url = String(source.url || "").trim();
  if (url && !/^https?:\/\//i.test(url)) throw new Error("Social links must start with http:// or https://");
  return { url, enabled: Boolean(source.enabled) && Boolean(url) };
}

function publicSettings(row) {
  const result = {};
  ACCOUNT_KEYS.forEach((key) => {
    const account = row[key] || {};
    if (account.enabled && account.url) result[key] = { url: account.url, enabled: true };
  });
  return result;
}

async function getSettings() {
  return SocialSettings.findOneAndUpdate({ key: "default" }, {}, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
}

router.get("/social", async (_req, res) => {
  try { return res.json({ accounts: publicSettings(await getSettings()) }); }
  catch (error) { console.error("Public social settings error:", error); return res.status(500).json({ error: "Unable to load social settings" }); }
});

router.get("/social/admin", auth, adminOnly, async (_req, res) => {
  try { return res.json({ accounts: await getSettings() }); }
  catch (error) { console.error("Admin social settings error:", error); return res.status(500).json({ error: "Unable to load social settings" }); }
});

router.put("/social", auth, adminOnly, async (req, res) => {
  try {
    const updates = { updatedBy: req.user._id };
    ACCOUNT_KEYS.forEach((key) => { updates[key] = normalizeAccount(req.body?.[key]); });
    const accounts = await SocialSettings.findOneAndUpdate({ key: "default" }, { $set: updates }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }).lean();
    return res.json({ accounts });
  } catch (error) {
    if (error.message?.includes("Social links")) return res.status(400).json({ error: error.message });
    console.error("Save social settings error:", error);
    return res.status(500).json({ error: "Unable to save social settings" });
  }
});

module.exports = router;
