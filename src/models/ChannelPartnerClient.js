const mongoose = require("mongoose");

const statusHistorySchema = new mongoose.Schema({
  fromStatus: { type: String, default: "" },
  toStatus: { type: String, required: true },
  reason: { type: String, default: "", trim: true, maxlength: 1000 },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  actorLabel: { type: String, default: "system", trim: true, maxlength: 120 },
  createdAt: { type: Date, required: true, default: Date.now },
}, { _id: true });

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
  status: { type: String, enum: ["pending", "approved", "successful", "rejected", "expired"], default: "pending", index: true },
  claimActive: { type: Boolean, default: true, index: true },
  registeredAt: { type: Date, required: true, default: Date.now },
  ownershipExpiresAt: { type: Date, required: true, index: true },
  bookingAdvanceAmountPaise: { type: Number, default: 0, min: 0 },
  initialCpRatePercent: { type: Number, default: 20, min: 0, max: 100 },
  initialCpAmountPaise: { type: Number, default: 0, min: 0 },
  approvedAt: { type: Date, default: null },
  initialCreditAt: { type: Date, default: null, index: true },
  finalSettlementCpAmountPaise: { type: Number, default: 0, min: 0 },
  successfulAt: { type: Date, default: null },
  statusHistory: { type: [statusHistorySchema], default: [] },
  idempotencyHash: { type: String, unique: true, sparse: true, select: false },
}, { timestamps: true });

channelPartnerClientSchema.index(
  { mobileHash: 1 },
  { name: "mobileHash_active_claim_unique", unique: true, partialFilterExpression: { claimActive: true } },
);
channelPartnerClientSchema.index({ partnerId: 1, status: 1, ownershipExpiresAt: -1 });

module.exports = mongoose.model("ChannelPartnerClient", channelPartnerClientSchema);
