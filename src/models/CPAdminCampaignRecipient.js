const mongoose = require("mongoose");

const cpAdminCampaignRecipientSchema = new mongoose.Schema({
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "CPAdminCampaign", required: true, index: true },
  batchId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  prospectId: { type: mongoose.Schema.Types.ObjectId, ref: "CPProspect", required: true, index: true },
  message: { type: String, default: "", trim: true, maxlength: 5000 },
  attachments: { type: mongoose.Schema.Types.Mixed, default: [] },
  senderNumber: { type: String, default: "", trim: true, maxlength: 30 },
  status: { type: String, enum: ["pending", "opened", "sent", "failed", "skipped"], default: "pending", index: true },
  failureReason: { type: String, default: "", trim: true, maxlength: 500 },
  openedAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },
}, { timestamps: true });

cpAdminCampaignRecipientSchema.index({ campaignId: 1, prospectId: 1 }, { unique: true });

module.exports = mongoose.model("CPAdminCampaignRecipient", cpAdminCampaignRecipientSchema);
