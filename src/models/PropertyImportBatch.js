const mongoose = require("mongoose");

const conflictSchema = new mongoose.Schema({
  reraNumber: { type: String, required: true, trim: true },
  projects: [{ type: String, trim: true }],
}, { _id: false });

const recordSchema = new mongoose.Schema({
  packageKey: { type: String, required: true, trim: true },
  packageName: { type: String, required: true, trim: true },
  projectName: { type: String, required: true, trim: true },
  reviewFile: { type: String, default: "", trim: true },
  status: { type: String, enum: ["awaiting", "uploading", "imported", "skipped", "failed"], default: "awaiting" },
  property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", default: null },
  reraNumbers: [{ type: String, trim: true }],
  mediaCount: { type: Number, min: 0, default: 0 },
  mediaBytes: { type: Number, min: 0, default: 0 },
  documentCount: { type: Number, min: 0, default: 0 },
  documentBytes: { type: Number, min: 0, default: 0 },
  warnings: [{ type: String, trim: true }],
  error: { type: String, default: "", trim: true },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false });

const propertyImportBatchSchema = new mongoose.Schema({
  batchKey: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  sourceFolder: { type: String, default: "", trim: true },
  reviewFolder: { type: String, default: "", trim: true },
  status: { type: String, enum: ["staged", "importing", "completed", "partial", "failed"], default: "staged", index: true },
  packageCount: { type: Number, min: 0, default: 0 },
  importedCount: { type: Number, min: 0, default: 0 },
  skippedCount: { type: Number, min: 0, default: 0 },
  failedCount: { type: Number, min: 0, default: 0 },
  mediaCount: { type: Number, min: 0, default: 0 },
  mediaBytes: { type: Number, min: 0, default: 0 },
  documentCount: { type: Number, min: 0, default: 0 },
  documentBytes: { type: Number, min: 0, default: 0 },
  cloudinaryCreditsBefore: { type: Number, min: 0 },
  cloudinaryCreditsAfter: { type: Number, min: 0 },
  sharedReraNumbers: { type: [conflictSchema], default: [] },
  records: { type: [recordSchema], default: [] },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

propertyImportBatchSchema.index({ updatedAt: -1 });

module.exports = mongoose.model("PropertyImportBatch", propertyImportBatchSchema);
