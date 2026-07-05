const mongoose = require("mongoose");

const dealerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    agency: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    logo: { type: String, default: "" },
    about: { type: String, default: "" },
    dealsIn: [{ type: String }],
    localities: [{ type: String }],
    city: { type: String, default: "", trim: true },
    memberSince: { type: String, default: "" },
    operatingSince: { type: String, default: "" },
    buyersThisWeek: { type: Number, default: 0 },
    propertyIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Property" }],
    rating: { type: Number, default: 0, min: 0, max: 5 },
    verified: { type: Boolean, default: false },
    featured: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Dealer", dealerSchema);
