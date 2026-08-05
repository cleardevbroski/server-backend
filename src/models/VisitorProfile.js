const mongoose = require("mongoose");

const visitorProfileSchema = new mongoose.Schema({
  visitorHash: { type: String, required: true, unique: true, select: false },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  visitCount: { type: Number, default: 0, min: 0, index: true },
  totalActiveSeconds: { type: Number, default: 0, min: 0 },
  totalPropertyViews: { type: Number, default: 0, min: 0 },
  leadScore: { type: Number, default: 0, min: 0, index: true },
  firstSeenAt: { type: Date, required: true, default: Date.now },
  lastSeenAt: { type: Date, required: true, default: Date.now, index: true },
  identifiedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

visitorProfileSchema.index({ visitCount: 1, lastSeenAt: -1 });

module.exports = mongoose.model("VisitorProfile", visitorProfileSchema);
