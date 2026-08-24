const mongoose = require("mongoose");

const guestSessionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^[6-9]\d{9}$/, "Please enter a valid 10-digit Indian mobile number"],
    },
    role: { type: String, enum: ["guest"], default: "guest" },
    isVerified: { type: Boolean, default: false },
    verificationSource: { type: String, enum: ["manual"], default: "manual" },
    consentAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

guestSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
guestSessionSchema.index({ phone: 1, createdAt: -1 });

module.exports = mongoose.model("GuestSession", guestSessionSchema);
