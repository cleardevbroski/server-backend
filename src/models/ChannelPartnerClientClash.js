const mongoose = require("mongoose");

const channelPartnerClientClashSchema = new mongoose.Schema({
  attemptingPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: "ChannelPartner", required: true, index: true },
  owningPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: "ChannelPartner", required: true, index: true },
  owningClientId: { type: mongoose.Schema.Types.ObjectId, ref: "ChannelPartnerClient", required: true, index: true },
  mobileHash: { type: String, required: true, select: false },
  mobileLast4: { type: String, required: true },
  clientName: { type: String, required: true, trim: true, maxlength: 140 },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Property", required: true },
  projectTitle: { type: String, required: true, trim: true, maxlength: 180 },
  outcome: { type: String, enum: ["rejected_active_claim"], default: "rejected_active_claim" },
  attemptedAt: { type: Date, required: true, default: Date.now, index: true },
}, { timestamps: true });

channelPartnerClientClashSchema.index({ attemptingPartnerId: 1, attemptedAt: -1 });
channelPartnerClientClashSchema.index({ owningPartnerId: 1, attemptedAt: -1 });

module.exports = mongoose.model("ChannelPartnerClientClash", channelPartnerClientClashSchema);
