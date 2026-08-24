const mongoose = require("mongoose");

const truecallerVerificationSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true, unique: true, index: true },
    purpose: {
      type: String,
      enum: ["login", "enquiry", "brochure", "site_visit", "contact"],
      default: "login",
    },
    status: {
      type: String,
      enum: ["pending", "invoked", "verified", "rejected", "failed", "consumed"],
      default: "pending",
      index: true,
    },
    phone: { type: String, default: "" },
    name: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    failureReason: { type: String, default: "", select: false },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TruecallerVerification", truecallerVerificationSchema);
