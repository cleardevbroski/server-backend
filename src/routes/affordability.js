const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const AffordabilityRule = require("../models/AffordabilityRule");
const AffordabilitySettings = require("../models/AffordabilitySettings");
const Property = require("../models/Property");
const { affordabilityForProperty, getSettings } = require("../services/affordabilityService");

const router = express.Router();

function cleanList(value, limit = 20) {
  return Array.isArray(value) ? [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, limit) : [];
}

function cleanSlabs(value) {
  return Array.isArray(value) ? value.slice(0, 30).map((row) => ({
    minValue: Math.max(0, Number(row.minValue) || 0),
    maxValue: row.maxValue === "" || row.maxValue == null ? null : Math.max(0, Number(row.maxValue) || 0),
    rate: Math.max(0, Number(row.rate) || 0),
    fixedAmount: Math.max(0, Number(row.fixedAmount) || 0),
  })) : [];
}

function rulePayload(body, userId) {
  const source = body && typeof body === "object" ? body : {};
  const name = String(source.name || "").trim();
  const code = String(source.code || name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const state = String(source.state || "").trim();
  const calculationType = String(source.calculationType || "");
  if (!name || !code || !state) throw new Error("Name, code and state are required");
  if (!["percentage", "fixed", "per_sqft", "slab"].includes(calculationType)) throw new Error("Select a valid calculation method");
  const effectiveFrom = new Date(source.effectiveFrom);
  if (Number.isNaN(effectiveFrom.getTime())) throw new Error("Enter a valid effective-from date");
  const effectiveTo = source.effectiveTo ? new Date(source.effectiveTo) : null;
  if (effectiveTo && Number.isNaN(effectiveTo.getTime())) throw new Error("Enter a valid effective-to date");
  if (effectiveTo && effectiveTo < effectiveFrom) throw new Error("Effective-to date cannot be before effective-from date");
  return {
    name,
    code,
    state,
    city: String(source.city || "").trim(),
    propertyTypes: cleanList(source.propertyTypes),
    possessionStatuses: cleanList(source.possessionStatuses),
    calculationType,
    basis: ["base_price", "agreement_value", "built_up_area"].includes(source.basis) ? source.basis : "base_price",
    rate: Math.max(0, Number(source.rate) || 0),
    fixedAmount: Math.max(0, Number(source.fixedAmount) || 0),
    slabs: cleanSlabs(source.slabs),
    minPropertyValue: Math.max(0, Number(source.minPropertyValue) || 0),
    maxPropertyValue: source.maxPropertyValue === "" || source.maxPropertyValue == null ? null : Math.max(0, Number(source.maxPropertyValue) || 0),
    effectiveFrom,
    effectiveTo,
    sourceLabel: String(source.sourceLabel || "").trim(),
    sourceUrl: String(source.sourceUrl || "").trim(),
    notes: String(source.notes || "").trim(),
    priority: Math.max(0, Math.min(1000, Number(source.priority) || 100)),
    active: source.active !== false,
    updatedBy: userId,
  };
}

router.get("/settings", async (req, res) => {
  try { return res.json({ settings: await getSettings() }); }
  catch (error) { console.error("Affordability settings error:", error); return res.status(500).json({ error: "Unable to load affordability settings" }); }
});

router.put("/settings", auth, adminOnly, async (req, res) => {
  try {
    const minRatio = Number(req.body.comfortableIncomeRatioMin);
    const maxRatio = Number(req.body.comfortableIncomeRatioMax);
    if (!(minRatio >= 0.05 && minRatio <= 0.9 && maxRatio >= 0.05 && maxRatio <= 0.9 && minRatio <= maxRatio)) {
      return res.status(400).json({ error: "Income ratios must be between 5% and 90%, with minimum not exceeding maximum" });
    }
    const settings = await AffordabilitySettings.findOneAndUpdate(
      { key: "default" },
      { $set: {
        defaultInterestRate: Number(req.body.defaultInterestRate),
        defaultTenureYears: Number(req.body.defaultTenureYears),
        comfortableIncomeRatioMin: minRatio,
        comfortableIncomeRatioMax: maxRatio,
        defaultState: String(req.body.defaultState || "Karnataka").trim(),
        disclaimer: String(req.body.disclaimer || "").trim(),
        updatedBy: req.user._id,
      } },
      { upsert: true, new: true, runValidators: true },
    ).lean();
    return res.json({ settings });
  } catch (error) {
    if (error.name === "ValidationError") return res.status(400).json({ error: error.message });
    console.error("Save affordability settings error:", error); return res.status(500).json({ error: "Unable to save affordability settings" });
  }
});

router.get("/rules", auth, adminOnly, async (req, res) => {
  try { return res.json({ rules: await AffordabilityRule.find().sort({ active: -1, priority: 1, effectiveFrom: -1 }).lean() }); }
  catch (error) { console.error("List affordability rules error:", error); return res.status(500).json({ error: "Unable to load affordability rules" }); }
});

router.post("/rules", auth, adminOnly, async (req, res) => {
  try { return res.status(201).json({ rule: await AffordabilityRule.create(rulePayload(req.body, req.user._id)) }); }
  catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "A rule with this code, location and effective date already exists" });
    if (error.name === "ValidationError" || error.message?.startsWith("Name") || error.message?.startsWith("Select") || error.message?.startsWith("Enter") || error.message?.startsWith("Effective")) return res.status(400).json({ error: error.message });
    console.error("Create affordability rule error:", error); return res.status(500).json({ error: "Unable to create affordability rule" });
  }
});

router.put("/rules/:id", auth, adminOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Rule not found" });
    const rule = await AffordabilityRule.findByIdAndUpdate(req.params.id, rulePayload(req.body, req.user._id), { new: true, runValidators: true });
    if (!rule) return res.status(404).json({ error: "Rule not found" });
    return res.json({ rule });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "A rule with this code, location and effective date already exists" });
    if (error.name === "ValidationError") return res.status(400).json({ error: error.message });
    console.error("Update affordability rule error:", error); return res.status(500).json({ error: error.message || "Unable to update affordability rule" });
  }
});

router.delete("/rules/:id", auth, adminOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Rule not found" });
    const rule = await AffordabilityRule.findByIdAndUpdate(req.params.id, { $set: { active: false, updatedBy: req.user._id } }, { new: true });
    if (!rule) return res.status(404).json({ error: "Rule not found" });
    return res.json({ rule, message: "Rule deactivated" });
  } catch (error) { console.error("Deactivate affordability rule error:", error); return res.status(500).json({ error: "Unable to deactivate affordability rule" }); }
});

router.post("/properties/:id/calculate", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Property not found" });
    const property = await Property.findOne({
      _id: req.params.id,
      $or: [{ status: { $in: ["approved", "published"] } }, { status: { $exists: false }, published: { $ne: false } }],
    }).lean();
    if (!property) return res.status(404).json({ error: "Property not found" });
    return res.json({ affordability: await affordabilityForProperty(property, req.body || {}) });
  } catch (error) { console.error("Calculate affordability error:", error); return res.status(500).json({ error: "Unable to calculate the affordability estimate" }); }
});

module.exports = router;
