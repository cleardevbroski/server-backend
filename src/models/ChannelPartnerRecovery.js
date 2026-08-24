const mongoose = require("mongoose");

const channelPartnerRecoverySchema = new mongoose.Schema({
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "ChannelPartner", required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  otpHash: { type: String, required: true, select: false },
  attempts: { type: Number, default: 0, min: 0 },
  expiresAt: { type: Date, required: true },
  resendAvailableAt: { type: Date, required: true },
}, { timestamps: true });

channelPartnerRecoverySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("ChannelPartnerRecovery", channelPartnerRecoverySchema);
