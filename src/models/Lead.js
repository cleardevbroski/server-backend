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

module.exports = mongoose.model("Lead", leadSchema);
