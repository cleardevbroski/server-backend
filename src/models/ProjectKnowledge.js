const mongoose = require("mongoose");

const evidenceRefSchema = new mongoose.Schema({
  evidenceId: { type: String, required: true, trim: true, maxlength: 250 },
  contentHash: { type: String, required: true, trim: true, maxlength: 64 },
  type: { type: String, required: true, trim: true, maxlength: 80 },
  label: { type: String, required: true, trim: true, maxlength: 250 },
  excerpt: { type: String, required: true, trim: true, maxlength: 6000 },
  phase: { type: String, default: "", trim: true, maxlength: 120 },
  pageNumber: { type: Number, min: 1 },
  documentExtraction: { type: mongoose.Schema.Types.ObjectId, ref: "DocumentExtraction", default: null },
}, { _id: false });

const revisionSchema = new mongoose.Schema({
  canonicalQuestion: { type: String, required: true, trim: true, maxlength: 1000 },
  aliases: [{ type: String, trim: true, maxlength: 1000 }],
  answer: { type: String, required: true, trim: true, maxlength: 5000 },
  evidenceRefs: { type: [evidenceRefSchema], default: [] },
  editedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  editedAt: { type: Date, default: Date.now },
}, { _id: false });

const projectKnowledgeSchema = new mongoose.Schema({
  property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", required: true, index: true },
  canonicalQuestion: { type: String, required: true, trim: true, maxlength: 1000 },
  normalizedQuestion: { type: String, required: true, trim: true, maxlength: 1000 },
  aliases: [{ type: String, trim: true, maxlength: 1000 }],
  normalizedAliases: [{ type: String, trim: true, maxlength: 1000 }],
  answer: { type: String, required: true, trim: true, maxlength: 5000 },
  evidenceRefs: { type: [evidenceRefSchema], default: [] },
  active: { type: Boolean, default: true, index: true },
  stale: { type: Boolean, default: false, index: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  approvedAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: null },
  useCount: { type: Number, min: 0, default: 0 },
  revisions: { type: [revisionSchema], default: [] },
}, { timestamps: true });

projectKnowledgeSchema.index({ property: 1, normalizedQuestion: 1 }, { unique: true });
projectKnowledgeSchema.index({ property: 1, active: 1, stale: 1 });

module.exports = mongoose.model("ProjectKnowledge", projectKnowledgeSchema);
