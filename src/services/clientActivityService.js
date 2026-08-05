const crypto = require("crypto");

const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const ACTION_SCORE = { brochure: 10, contact: 12, enquiry: 15, share: 2, whatsapp: 15, priceList: 5, floorPlan: 5, favorite: 8, unfavorite: 0 };

const hashActivityId = (value, namespace) => crypto.createHash("sha256").update(`${namespace}:${value}`).digest("hex");
const activityExpiry = (now = new Date()) => new Date(now.getTime() + RETENTION_MS);

function rupeeValue(priceLabel) {
  const normalized = String(priceLabel || "").toLowerCase().replace(/,/g, "");
  const match = normalized.match(/(?:₹|rs\.?\s*)?([0-9]+(?:\.[0-9]+)?)\s*(cr|crore|l|lac|lakh)?/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;
  if (["cr", "crore"].includes(match[2])) return amount * 10000000;
  if (["l", "lac", "lakh"].includes(match[2])) return amount * 100000;
  return amount;
}

function budgetBand(priceLabel) {
  const value = rupeeValue(priceLabel);
  if (!value) return "Unknown";
  if (value < 5000000) return "Under ₹50 L";
  if (value < 8000000) return "₹50–80 L";
  if (value < 10000000) return "₹80 L–1 Cr";
  if (value < 15000000) return "₹1–1.5 Cr";
  if (value < 20000000) return "₹1.5–2 Cr";
  if (value < 30000000) return "₹2–3 Cr";
  return "₹3 Cr+";
}

function engagementScore(activeSeconds, action) {
  return Math.min(Math.floor(activeSeconds / 60), 10) + (ACTION_SCORE[action] || 0);
}

module.exports = { hashActivityId, activityExpiry, budgetBand, engagementScore };
