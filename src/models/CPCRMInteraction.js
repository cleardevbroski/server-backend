const mongoose = require("mongoose");

const ACTIONS = ["call_started", "call_result", "whatsapp_number_updated", "whatsapp_opened", "whatsapp_result", "note"];
const OUTCOMES = [
  "", "no_answer", "busy", "connected", "callback_requested", "interested", "has_clients",
  "needs_project_details", "not_interested", "wrong_number", "do_not_contact", "other",
  "sent", "not_sent", "failed",
];

const cpCrmInteractionSchema = new mongoose.Schema({
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "ChannelPartner", required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "CRMStaffAccount", required: true, index: true },
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: "CPCRMTask", default: null, index: true },
  action: { type: String, enum: ACTIONS, required: true, index: true },
  outcome: { type: String, enum: OUTCOMES, default: "", index: true },
  note: { type: String, default: "", trim: true, maxlength: 2000 },
  messageBody: { type: String, default: "", trim: true, maxlength: 5000 },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: "CPCRMMessageTemplate", default: null },
  callbackAt: { type: Date, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

cpCrmInteractionSchema.index({ employeeId: 1, createdAt: -1 });
cpCrmInteractionSchema.index({ partnerId: 1, createdAt: -1 });

const CPCRMInteraction = mongoose.model("CPCRMInteraction", cpCrmInteractionSchema);
CPCRMInteraction.ACTIONS = ACTIONS;
CPCRMInteraction.OUTCOMES = OUTCOMES;

module.exports = CPCRMInteraction;
