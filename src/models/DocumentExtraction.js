const mongoose = require("mongoose");

const extractedPageSchema = new mongoose.Schema({
  pageNumber: { type: Number, required: true, min: 1 },
  originalText: { type: String, default: "", maxlength: 100000 },
  reviewedText: { type: String, default: "", maxlength: 100000 },
  method: { type: String, enum: ["embedded_text", "ocr"], required: true },
}, { _id: false });

const documentExtractionSchema = new mongoose.Schema({
  property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", required: true, index: true },
  phaseId: { type: String, default: "", trim: true, maxlength: 100 },
  phaseName: { type: String, default: "", trim: true, maxlength: 120 },
  sourceKind: { type: String, enum: ["rera_document", "project_document", "project_download", "brochure"], required: true },
  documentKey: { type: String, required: true, trim: true, maxlength: 600 },
  documentFingerprint: { type: String, required: true, trim: true, maxlength: 64 },
  label: { type: String, required: true, trim: true, maxlength: 250 },
  fileName: { type: String, required: true, trim: true, maxlength: 500 },
  fileUrl: { type: String, required: true, trim: true, maxlength: 4000 },
  mimeType: { type: String, enum: ["application/pdf", "image/jpeg", "image/png"], required: true },
  fileSize: { type: Number, min: 0, default: 0 },
  status: { type: String, enum: ["queued", "processing", "review_required", "approved", "rejected", "failed"], default: "queued", index: true },
  extractionMethod: { type: String, enum: ["", "embedded_text", "ocr", "mixed"], default: "" },
  pages: { type: [extractedPageSchema], default: [] },
  pageCount: { type: Number, min: 0, default: 0 },
  characterCount: { type: Number, min: 0, default: 0 },
  error: { type: String, default: "", trim: true, maxlength: 2000 },
  extractedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
}, { timestamps: true });

documentExtractionSchema.index({ property: 1, documentKey: 1 }, { unique: true });
documentExtractionSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.model("DocumentExtraction", documentExtractionSchema);
