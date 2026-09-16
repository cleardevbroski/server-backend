const mongoose = require("mongoose");

const cpProspectInteractionSchema = new mongoose.Schema({
  prospectId: { type: mongoose.Schema.Types.ObjectId, ref: "CPProspect", required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "CRMStaffAccount", required: true, index: true },
  action: { type: String, enum: ["call_started", "verification_result", "broker_call_result", "profile_updated", "whatsapp_opened", "whatsapp_result", "note"], required: true, index: true },
  outcome: { type: String, default: "", trim: true, maxlength: 60, index: true },
  note: { type: String, default: "", trim: true, maxlength: 2000 },
  messageBody: { type: String, default: "", trim: true, maxlength: 5000 },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: "CPCRMMessageTemplate", default: null },
  callbackAt: { type: Date, default: null },
  changedFields: [{ type: String, trim: true, maxlength: 100 }],
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

cpProspectInteractionSchema.index({ prospectId: 1, createdAt: -1 });
cpProspectInteractionSchema.index({ employeeId: 1, createdAt: -1 });

module.exports = mongoose.model("CPProspectInteraction", cpProspectInteractionSchema);
