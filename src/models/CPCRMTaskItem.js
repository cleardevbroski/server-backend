const mongoose = require("mongoose");

const cpCrmTaskItemSchema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: "CPCRMTask", required: true, index: true },
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "ChannelPartner", required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "CRMStaffAccount", required: true, index: true },
  status: { type: String, enum: ["pending", "completed", "skipped"], default: "pending", index: true },
  outcome: { type: String, default: "", trim: true, maxlength: 60 },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

cpCrmTaskItemSchema.index({ taskId: 1, partnerId: 1 }, { unique: true });
cpCrmTaskItemSchema.index({ employeeId: 1, status: 1, createdAt: 1 });

module.exports = mongoose.model("CPCRMTaskItem", cpCrmTaskItemSchema);
