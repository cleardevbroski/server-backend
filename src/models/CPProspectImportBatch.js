const mongoose = require("mongoose");

const importErrorSchema = new mongoose.Schema({
  rowNumber: { type: Number, required: true },
  message: { type: String, required: true, trim: true, maxlength: 500 },
}, { _id: false });

const cpProspectImportBatchSchema = new mongoose.Schema({
  prospectType: { type: String, enum: ["channel_partner", "broker"], default: "channel_partner", index: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  originalFileName: { type: String, required: true, trim: true, maxlength: 240 },
  totalRows: { type: Number, required: true, min: 1, max: 100000 },
  processedRows: { type: Number, default: 0, min: 0 },
  importedCount: { type: Number, default: 0, min: 0 },
  duplicateCount: { type: Number, default: 0, min: 0 },
  invalidCount: { type: Number, default: 0, min: 0 },
  matchedRegisteredCount: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ["importing", "completed", "failed"], default: "importing", index: true },
  mapping: { type: mongoose.Schema.Types.Mixed, default: {} },
  errorSamples: { type: [importErrorSchema], default: [] },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

cpProspectImportBatchSchema.index({ prospectType: 1, createdAt: -1 });

module.exports = mongoose.model("CPProspectImportBatch", cpProspectImportBatchSchema);
