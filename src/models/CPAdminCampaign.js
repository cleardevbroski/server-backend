const mongoose = require("mongoose");

const campaignAttachmentSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  url: { type: String, required: true, trim: true, maxlength: 1000 },
  mimeType: { type: String, default: "", trim: true, maxlength: 100 },
  bytes: { type: Number, default: 0, min: 0 },
}, { _id: true });

const batchSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  senderNumber: { type: String, default: "", trim: true, maxlength: 30 },
  message: { type: String, default: "", trim: true, maxlength: 5000 },
  attachments: { type: [campaignAttachmentSchema], default: [] },
  recipientIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "CPProspect" }],
}, { _id: true });

const cpAdminCampaignSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 160 },
  status: { type: String, enum: ["draft", "active", "completed", "cancelled"], default: "draft", index: true },
  filters: { type: mongoose.Schema.Types.Mixed, default: {} },
  batches: { type: [batchSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

module.exports = mongoose.model("CPAdminCampaign", cpAdminCampaignSchema);
