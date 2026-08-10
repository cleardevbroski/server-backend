const mongoose = require("mongoose");

const mediaCleanupJobSchema = new mongoose.Schema(
  {
    propertyId: { type: String, required: true, index: true },
    propertyTitle: { type: String, default: "" },
    assets: [{
      publicId: { type: String, required: true },
      resourceType: { type: String, enum: ["image", "raw", "video"], required: true },
    }],
    status: { type: String, enum: ["pending", "completed"], default: "pending", index: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MediaCleanupJob", mediaCleanupJobSchema);
