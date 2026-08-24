const mongoose = require("mongoose");

const propertyEmailOtpSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    otpHash: { type: String, required: true, select: false },
    attempts: { type: Number, default: 0, min: 0 },
    expiresAt: { type: Date, required: true },
    resendAvailableAt: { type: Date, required: true },
  },
  { timestamps: true },
);

propertyEmailOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("PropertyEmailOtp", propertyEmailOtpSchema);
