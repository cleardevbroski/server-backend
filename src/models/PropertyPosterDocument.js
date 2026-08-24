const mongoose = require("mongoose");

const PURPOSES = [
  "company-pan",
  "company-rera",
  "company-registration",
  "individual-pan",
  "individual-aadhaar",
  "individual-ownership",
];

const propertyPosterDocumentSchema = new mongoose.Schema(
  {
    posterAccount: { type: mongoose.Schema.Types.ObjectId, ref: "PropertyPosterAccount", required: true, index: true },
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", default: null, index: true },
    purpose: { type: String, enum: PURPOSES, required: true },
    publicId: { type: String, required: true },
    resourceType: { type: String, enum: ["image", "raw"], required: true },
    deliveryType: { type: String, enum: ["authenticated"], default: "authenticated" },
    version: { type: Number, min: 1 },
    format: { type: String, default: "", trim: true },
    mimeType: { type: String, required: true },
    fileName: { type: String, required: true, trim: true, maxlength: 240 },
    bytes: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);

propertyPosterDocumentSchema.index({ posterAccount: 1, createdAt: -1 });

module.exports = mongoose.model("PropertyPosterDocument", propertyPosterDocumentSchema);
module.exports.PURPOSES = PURPOSES;
