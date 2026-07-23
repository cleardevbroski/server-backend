const mongoose = require("mongoose");

const ANALYTICS_EVENT_TYPES = [
  "page_view",
  "property_view",
  "property_share",
  "search",
  "brochure_download",
  "contact_reveal",
  "enquiry_submitted",
  "contact_form_submitted",
  "legal_query_submitted",
  "lawyer_consultation_opened",
  "lawyer_consultation_submitted",
  "whatsapp_consultation_opened",
  "public_property_submitted",
];

const analyticsEventSchema = new mongoose.Schema(
  {
    eventType: { type: String, required: true, trim: true, enum: ANALYTICS_EVENT_TYPES },
    sessionId: { type: String, default: "", trim: true, maxlength: 80 },
    path: { type: String, default: "", trim: true, maxlength: 500 },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

// Analytics rollups query by event type over a time window (ESR)
analyticsEventSchema.index({ eventType: 1, createdAt: -1 });
analyticsEventSchema.index({ sessionId: 1, createdAt: -1 });

module.exports = mongoose.model("AnalyticsEvent", analyticsEventSchema);
module.exports.ANALYTICS_EVENT_TYPES = ANALYTICS_EVENT_TYPES;
