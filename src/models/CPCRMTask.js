const mongoose = require("mongoose");

const cpCrmTaskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  instructions: { type: String, default: "", trim: true, maxlength: 2000 },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "CRMStaffAccount", required: true, index: true },
  targetCount: { type: Number, required: true, min: 1, max: 500 },
  assignedCount: { type: Number, default: 0, min: 0 },
  completedCount: { type: Number, default: 0, min: 0 },
  dueAt: { type: Date, default: null, index: true },
  status: { type: String, enum: ["active", "completed", "cancelled"], default: "active", index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

cpCrmTaskSchema.index({ employeeId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("CPCRMTask", cpCrmTaskSchema);
