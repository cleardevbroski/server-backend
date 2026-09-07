const mongoose = require("mongoose");

const projectQuestionSchema = new mongoose.Schema({
  property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", required: true, index: true },
  question: { type: String, required: true, trim: true, maxlength: 1000 },
  normalizedQuestion: { type: String, required: true, trim: true, maxlength: 1000 },
  category: { type: String, default: "general", trim: true, maxlength: 80 },
  status: { type: String, enum: ["unanswered", "answered", "needs_review", "dismissed"], default: "unanswered", index: true },
  occurrences: { type: Number, min: 1, default: 1 },
  firstAskedAt: { type: Date, default: Date.now },
  lastAskedAt: { type: Date, default: Date.now, index: true },
  lastOutcome: { type: String, enum: ["unavailable", "structured_evidence", "approved_knowledge"], default: "unavailable" },
  matchedKnowledge: { type: mongoose.Schema.Types.ObjectId, ref: "ProjectKnowledge", default: null },
  feedbackCount: { type: Number, min: 0, default: 0 },
  lastFeedbackReason: { type: String, default: "", trim: true, maxlength: 1000 },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  resolvedAt: { type: Date, default: null },
  dismissedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  dismissedAt: { type: Date, default: null },
}, { timestamps: true });

projectQuestionSchema.index({ property: 1, normalizedQuestion: 1 }, { unique: true });
projectQuestionSchema.index({ status: 1, occurrences: -1, lastAskedAt: -1 });

module.exports = mongoose.model("ProjectQuestion", projectQuestionSchema);
