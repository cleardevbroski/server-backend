const mongoose = require("mongoose");

const lawyerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    experience: { type: String, required: true, trim: true },
    barCouncil: { type: String, required: true, trim: true },
    rating: { type: Number, default: 5, min: 1, max: 5 },
    cases: { type: String, required: true },
    specialty: { type: String, required: true },
    image: { type: String, default: "" },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "approved" },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Lawyer", lawyerSchema);
