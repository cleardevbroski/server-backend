const mongoose = require("mongoose");

const LEAD_STATUSES = ["new", "contacted", "interested", "site_visit_scheduled", "visited", "callback_requested", "negotiating", "booked", "not_interested", "invalid_number"];

const cpEmployeeLeadSchema = new mongoose.Schema({
  serialNumber: { type: Number, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  mobile: { type: String, required: true, trim: true },
  mobileHash: { type: String, required: true, unique: true, index: true, select: false },
  alternateMobile: { type: String, default: "", trim: true },
  whatsappMobile: { type: String, default: "", trim: true },
  email: { type: String, default: "", lowercase: true, trim: true, maxlength: 254 },
  source: { type: String, default: "employee", trim: true, maxlength: 80 },
  projectInterest: { type: String, default: "", trim: true, maxlength: 200 },
  propertyType: { type: String, default: "", trim: true, maxlength: 80 },
  budget: { type: String, default: "", trim: true, maxlength: 80 },
  city: { type: String, default: "", trim: true, maxlength: 100, index: true },
  area: { type: String, default: "", trim: true, maxlength: 100 },
  status: { type: String, enum: LEAD_STATUSES, default: "new", index: true },
  feedback: { type: String, default: "", trim: true, maxlength: 2000 },
  nextFollowUpAt: { type: Date, default: null, index: true },
  visitAt: { type: Date, default: null, index: true },
  createdByEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "CRMStaffAccount", required: true, index: true },
  assignedEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "CRMStaffAccount", required: true, index: true },
  lastActivityAt: { type: Date, default: null, index: true },
}, { timestamps: true });

cpEmployeeLeadSchema.index({ assignedEmployeeId: 1, status: 1, nextFollowUpAt: 1 });
cpEmployeeLeadSchema.index({ assignedEmployeeId: 1, createdAt: -1 });

const CPEmployeeLead = mongoose.model("CPEmployeeLead", cpEmployeeLeadSchema);
CPEmployeeLead.STATUSES = LEAD_STATUSES;

module.exports = CPEmployeeLead;
