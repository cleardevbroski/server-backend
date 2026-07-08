const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["contact", "consultation"], required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    phone: { type: String, default: "", trim: true },
    message: { type: String, default: "" },
    category: { type: String, default: "" },
    status: { type: String, enum: ["new", "contacted", "closed"], default: "new" },
  },
  { timestamps: true },
);

// Admin lead list filters by status or type, sorted newest-first (ESR)
leadSchema.index({ status: 1, createdAt: -1 });
leadSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model("Lead", leadSchema);
