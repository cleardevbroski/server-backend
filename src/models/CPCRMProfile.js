const mongoose = require("mongoose");

const STAGES = ["new", "attempted", "callback", "interested", "has_clients", "not_interested", "do_not_contact"];

const cpCrmProfileSchema = new mongoose.Schema({
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "ChannelPartner", required: true, unique: true, index: true },
  assignedEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "CRMStaffAccount", default: null, index: true },
  stage: { type: String, enum: STAGES, default: "new", index: true },
  priority: { type: String, enum: ["normal", "important", "urgent"], default: "normal", index: true },
  lastInteractionAt: { type: Date, default: null },
  lastContactedAt: { type: Date, default: null },
  nextFollowUpAt: { type: Date, default: null, index: true },
  callAttempts: { type: Number, default: 0, min: 0 },
  completedCalls: { type: Number, default: 0, min: 0 },
  whatsappOpened: { type: Number, default: 0, min: 0 },
  whatsappSent: { type: Number, default: 0, min: 0 },
  whatsappMobile: { type: String, default: "", trim: true },
  whatsappUpdatedAt: { type: Date, default: null },
  whatsappUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "CRMStaffAccount", default: null },
}, { timestamps: true });

cpCrmProfileSchema.index({ assignedEmployeeId: 1, stage: 1, nextFollowUpAt: 1 });

const CPCRMProfile = mongoose.model("CPCRMProfile", cpCrmProfileSchema);
CPCRMProfile.STAGES = STAGES;

module.exports = CPCRMProfile;
