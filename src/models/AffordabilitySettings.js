const mongoose = require("mongoose");

const affordabilitySettingsSchema = new mongoose.Schema({
  key: { type: String, default: "default", unique: true, immutable: true },
  defaultInterestRate: { type: Number, min: 0, max: 50, default: 8.5 },
  defaultTenureYears: { type: Number, min: 1, max: 40, default: 20 },
  comfortableIncomeRatioMin: { type: Number, min: 0.05, max: 0.9, default: 0.3 },
  comfortableIncomeRatioMax: { type: Number, min: 0.05, max: 0.9, default: 0.4 },
  defaultState: { type: String, trim: true, default: "Karnataka" },
  disclaimer: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: "Planning estimate only. This is not a bank quotation or loan eligibility decision.",
  },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

module.exports = mongoose.model("AffordabilitySettings", affordabilitySettingsSchema);
