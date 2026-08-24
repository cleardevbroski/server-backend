const mongoose = require("mongoose");

const propertyPosterAccountSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    name: { type: String, default: "", trim: true, maxlength: 120 },
    phone: { type: String, default: "", trim: true },
    role: { type: String, enum: ["property_submitter"], default: "property_submitter" },
    isVerified: { type: Boolean, default: true },
    verificationSource: { type: String, enum: ["email"], default: "email" },
    emailVerifiedAt: { type: Date, required: true },
    lastLoginAt: { type: Date, required: true },
    disabledAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("PropertyPosterAccount", propertyPosterAccountSchema);
