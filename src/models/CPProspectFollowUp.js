const mongoose = require("mongoose");

const cpProspectFollowUpSchema = new mongoose.Schema({
  prospectId: { type: mongoose.Schema.Types.ObjectId, ref: "CPProspect", required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "CRMStaffAccount", required: true, index: true },
  sourceInteractionId: { type: mongoose.Schema.Types.ObjectId, ref: "CPProspectInteraction", required: true },
  scheduledAt: { type: Date, required: true, index: true },
  note: { type: String, default: "", trim: true, maxlength: 2000 },
  status: { type: String, enum: ["pending", "completed", "cancelled"], default: "pending", index: true },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

cpProspectFollowUpSchema.index({ employeeId: 1, status: 1, scheduledAt: 1 });

module.exports = mongoose.model("CPProspectFollowUp", cpProspectFollowUpSchema);
