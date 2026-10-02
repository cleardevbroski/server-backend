const mongoose = require("mongoose");

const cpEmployeeLeadActivitySchema = new mongoose.Schema({
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: "CPEmployeeLead", required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "CRMStaffAccount", required: true, index: true },
  action: { type: String, enum: ["lead_created", "status_updated", "call_result", "whatsapp_shared", "callback_scheduled", "site_visit_scheduled", "site_visit_completed", "note"], required: true, index: true },
  status: { type: String, default: "", trim: true, maxlength: 60, index: true },
  note: { type: String, default: "", trim: true, maxlength: 2000 },
  scheduledAt: { type: Date, default: null },
}, { timestamps: true });

cpEmployeeLeadActivitySchema.index({ employeeId: 1, createdAt: -1 });
cpEmployeeLeadActivitySchema.index({ leadId: 1, createdAt: -1 });

module.exports = mongoose.model("CPEmployeeLeadActivity", cpEmployeeLeadActivitySchema);
