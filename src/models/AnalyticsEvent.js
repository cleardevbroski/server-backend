const mongoose = require("mongoose");

const analyticsEventSchema = new mongoose.Schema(
  {
    eventType: { type: String, required: true, trim: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

// Analytics rollups query by event type over a time window (ESR)
analyticsEventSchema.index({ eventType: 1, createdAt: -1 });

module.exports = mongoose.model("AnalyticsEvent", analyticsEventSchema);
