const mongoose = require("mongoose");

const cpCrmFollowUpSchema = new mongoose.Schema({
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "ChannelPartner", required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "CRMStaffAccount", required: true, index: true },
  sourceInteractionId: { type: mongoose.Schema.Types.ObjectId, ref: "CPCRMInteraction", required: true },
  scheduledAt: { type: Date, required: true, index: true },
  priority: { type: String, enum: ["normal", "important", "urgent"], default: "normal" },
  note: { type: String, default: "", trim: true, maxlength: 2000 },
  status: { type: String, enum: ["pending", "completed", "cancelled"], default: "pending", index: true },
  completedAt: { type: Date, default: null },
  completionInteractionId: { type: mongoose.Schema.Types.ObjectId, ref: "CPCRMInteraction", default: null },
}, { timestamps: true });

cpCrmFollowUpSchema.index({ employeeId: 1, status: 1, scheduledAt: 1 });

module.exports = mongoose.model("CPCRMFollowUp", cpCrmFollowUpSchema);
