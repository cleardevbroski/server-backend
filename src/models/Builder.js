const mongoose = require("mongoose");

const builderSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    logo: { type: String, default: "" },
    established: { type: String, default: "" },
    description: { type: String, default: "" },
    longDescription: { type: String, default: "" },
    headquarters: { type: String, default: "", trim: true },
    experienceYears: { type: Number, min: 0 },
    totalProjects: { type: Number, min: 0 },
    deliveredProjects: { type: Number, min: 0 },
    city: { type: String, default: "", trim: true },
    projectCount: { type: Number, default: 0 },
    verified: { type: Boolean, default: false },
    featured: { type: Boolean, default: false },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "approved" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Builder", builderSchema);
