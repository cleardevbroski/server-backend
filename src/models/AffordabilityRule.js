const mongoose = require("mongoose");

const slabSchema = new mongoose.Schema({
  minValue: { type: Number, min: 0, default: 0 },
  maxValue: { type: Number, min: 0, default: null },
  rate: { type: Number, min: 0, default: 0 },
  fixedAmount: { type: Number, min: 0, default: 0 },
}, { _id: false });

const affordabilityRuleSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  code: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
  state: { type: String, required: true, trim: true, maxlength: 120 },
  city: { type: String, default: "", trim: true, maxlength: 120 },
  propertyTypes: [{ type: String, trim: true }],
  possessionStatuses: [{ type: String, trim: true }],
  calculationType: {
    type: String,
    enum: ["percentage", "fixed", "per_sqft", "slab"],
    required: true,
  },
  basis: {
    type: String,
    enum: ["base_price", "agreement_value", "built_up_area"],
    default: "base_price",
  },
  rate: { type: Number, min: 0, default: 0 },
  fixedAmount: { type: Number, min: 0, default: 0 },
  slabs: { type: [slabSchema], default: [] },
  minPropertyValue: { type: Number, min: 0, default: 0 },
  maxPropertyValue: { type: Number, min: 0, default: null },
  effectiveFrom: { type: Date, required: true },
  effectiveTo: { type: Date, default: null },
  sourceLabel: { type: String, default: "", trim: true, maxlength: 300 },
  sourceUrl: { type: String, default: "", trim: true, maxlength: 2000 },
  notes: { type: String, default: "", trim: true, maxlength: 2000 },
  priority: { type: Number, min: 0, max: 1000, default: 100 },
  active: { type: Boolean, default: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

affordabilityRuleSchema.index({ state: 1, city: 1, active: 1, effectiveFrom: -1 });
affordabilityRuleSchema.index({ code: 1, state: 1, city: 1, effectiveFrom: 1 }, { unique: true });

module.exports = mongoose.model("AffordabilityRule", affordabilityRuleSchema);
