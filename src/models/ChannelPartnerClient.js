const mongoose = require("mongoose");

const channelPartnerClientSchema = new mongoose.Schema({
  leadNumber: { type: String, required: true, unique: true, immutable: true, index: true },
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "ChannelPartner", required: true, index: true },
  partnerCodeLast4: { type: String, required: true, immutable: true },
  clientName: { type: String, required: true, trim: true, maxlength: 140 },
  mobileEncrypted: { type: String, required: true, select: false },
  mobileHash: { type: String, required: true, select: false },
  mobileLast4: { type: String, required: true },
  emailEncrypted: { type: String, default: "", select: false },
  emailHash: { type: String, default: "", select: false },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Property", required: true, index: true },
  projectTitle: { type: String, required: true, trim: true, maxlength: 180 },
  budget: { type: String, default: "", trim: true, maxlength: 100 },
  notes: { type: String, default: "", trim: true, maxlength: 1000 },
  consentAcceptedAt: { type: Date, required: true },
  status: { type: String, enum: ["registered", "expired", "cancelled", "converted"], default: "registered", index: true },
  registeredAt: { type: Date, required: true, default: Date.now },
  ownershipExpiresAt: { type: Date, required: true, index: true },
  idempotencyHash: { type: String, unique: true, sparse: true, select: false },
}, { timestamps: true });

channelPartnerClientSchema.index(
  { mobileHash: 1 },
  { unique: true, partialFilterExpression: { status: "registered" } },
);
channelPartnerClientSchema.index({ partnerId: 1, status: 1, ownershipExpiresAt: -1 });

module.exports = mongoose.model("ChannelPartnerClient", channelPartnerClientSchema);
