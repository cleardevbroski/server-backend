const mongoose = require("mongoose");

const visitorSessionSchema = new mongoose.Schema({
  sessionHash: { type: String, required: true, unique: true, select: false },
  visitorId: { type: mongoose.Schema.Types.ObjectId, ref: "VisitorProfile", required: true, index: true },
  visitNumber: { type: Number, required: true, min: 1 },
  startedAt: { type: Date, required: true },
  lastActivityAt: { type: Date, required: true },
  activeSeconds: { type: Number, default: 0, min: 0 },
  propertyViewCount: { type: Number, default: 0, min: 0 },
  landingPath: { type: String, default: "", maxlength: 500 },
  referrer: { type: String, default: "", maxlength: 500 },
  deviceCategory: { type: String, enum: ["mobile", "tablet", "desktop", "unknown"], default: "unknown" },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

visitorSessionSchema.index({ visitorId: 1, startedAt: -1 });

module.exports = mongoose.model("VisitorSession", visitorSessionSchema);
