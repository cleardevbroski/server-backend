const mongoose = require("mongoose");

const testimonialSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, required: true, trim: true },
    quote: { type: String, required: true },
    rating: { type: Number, default: 5, min: 1, max: 5 },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "approved" },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Testimonial", testimonialSchema);
