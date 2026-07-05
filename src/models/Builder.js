const mongoose = require("mongoose");

const builderSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    logo: { type: String, default: "" },
    established: { type: String, default: "" },
    description: { type: String, default: "" },
    city: { type: String, default: "", trim: true },
    projectCount: { type: Number, default: 0 },
    verified: { type: Boolean, default: false },
    featured: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Builder", builderSchema);
