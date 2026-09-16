const mongoose = require("mongoose");

const crmStaffAccountSchema = new mongoose.Schema({
  employeeId: { type: String, required: true, unique: true, uppercase: true, trim: true, minlength: 3, maxlength: 40, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  phone: { type: String, default: "", trim: true, maxlength: 20 },
  email: { type: String, default: "", trim: true, lowercase: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ["employee", "manager"], default: "employee", index: true },
  permissions: [{ type: String, enum: ["cp_crm.view", "cp_crm.contact", "cp_crm.assign", "cp_crm.analytics"] }],
  isActive: { type: Boolean, default: true, index: true },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  sessionVersion: { type: Number, default: 0, min: 0 },
  lastLoginAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

crmStaffAccountSchema.index({ isDeleted: 1, isActive: 1, createdAt: -1 });

module.exports = mongoose.model("CRMStaffAccount", crmStaffAccountSchema);
