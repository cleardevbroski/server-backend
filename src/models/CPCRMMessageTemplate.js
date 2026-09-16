const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  url: { type: String, required: true, trim: true, maxlength: 1000 },
  mimeType: { type: String, default: "", trim: true, maxlength: 100 },
  bytes: { type: Number, default: 0, min: 0 },
}, { _id: true });

const cpCrmMessageTemplateSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  kind: { type: String, enum: ["project", "follow_up"], required: true, index: true },
  audience: { type: String, enum: ["all", "registered_cp", "imported_cp", "broker"], default: "all", index: true },
  projectName: { type: String, default: "", trim: true, maxlength: 180 },
  body: { type: String, required: true, trim: true, maxlength: 5000 },
  attachments: { type: [attachmentSchema], default: [] },
  isActive: { type: Boolean, default: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

cpCrmMessageTemplateSchema.index({ audience: 1, kind: 1, isActive: 1, createdAt: -1 });

module.exports = mongoose.model("CPCRMMessageTemplate", cpCrmMessageTemplateSchema);
