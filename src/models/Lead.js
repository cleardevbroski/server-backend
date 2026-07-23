const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["contact", "consultation", "property_interest"], required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    phone: { type: String, default: "", trim: true },
    message: { type: String, default: "" },
    category: { type: String, default: "" },
    propertyId: { type: String, default: "", trim: true },
    propertyTitle: { type: String, default: "", trim: true },
    propertyLocation: { type: String, default: "", trim: true },
    propertyUrl: { type: String, default: "", trim: true },
    lawyerId: { type: String, default: "", trim: true },
    lawyerName: { type: String, default: "", trim: true },
    audience: { type: String, enum: ["", "buyer", "builder"], default: "" },
    budget: { type: String, default: "", trim: true },
    action: { type: String, enum: ["", "brochure", "call", "enquiry"], default: "" },
    status: { type: String, enum: ["new", "contacted", "closed"], default: "new" },
  },
  { timestamps: true },
);

// Admin lead list filters by status or type, sorted newest-first (ESR)
leadSchema.index({ status: 1, createdAt: -1 });
leadSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model("Lead", leadSchema);
