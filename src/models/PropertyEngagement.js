const mongoose = require("mongoose");

const propertyEngagementSchema = new mongoose.Schema({
  visitorId: { type: mongoose.Schema.Types.ObjectId, ref: "VisitorProfile", required: true, index: true },
  propertyId: { type: String, required: true, trim: true, maxlength: 100 },
  propertyTitle: { type: String, default: "", trim: true, maxlength: 180 },
  propertyType: { type: String, default: "", trim: true, maxlength: 80, index: true },
  location: { type: String, default: "", trim: true, maxlength: 180 },
  priceLabel: { type: String, default: "", trim: true, maxlength: 100 },
  budgetBand: { type: String, default: "Unknown", trim: true, maxlength: 40, index: true },
  viewCount: { type: Number, default: 0, min: 0 },
  activeSeconds: { type: Number, default: 0, min: 0 },
  actionCount: { type: Number, default: 0, min: 0 },
  actions: {
    brochure: { type: Number, default: 0, min: 0 },
    contact: { type: Number, default: 0, min: 0 },
    enquiry: { type: Number, default: 0, min: 0 },
    share: { type: Number, default: 0, min: 0 },
    whatsapp: { type: Number, default: 0, min: 0 },
    priceList: { type: Number, default: 0, min: 0 },
    floorPlan: { type: Number, default: 0, min: 0 },
    favorite: { type: Number, default: 0, min: 0 },
    unfavorite: { type: Number, default: 0, min: 0 },
  },
  firstViewedAt: { type: Date, required: true, default: Date.now },
  lastViewedAt: { type: Date, required: true, default: Date.now, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

propertyEngagementSchema.index({ visitorId: 1, propertyId: 1 }, { unique: true });
propertyEngagementSchema.index({ visitorId: 1, activeSeconds: -1 });

module.exports = mongoose.model("PropertyEngagement", propertyEngagementSchema);
