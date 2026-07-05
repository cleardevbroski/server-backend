const mongoose = require("mongoose");

const insightSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    rating: { type: Number, default: 4.0, min: 1, max: 5 },
    pricePerSqft: { type: String, required: true, trim: true },
    yoy: { type: String, required: true, trim: true },
    image: { type: String, default: "" },
    href: { type: String, required: true, trim: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "approved" },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Insight", insightSchema);
