const mongoose = require("mongoose");

const decisionWorkspaceMessageSchema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: "DecisionWorkspace", required: true, index: true },
  participantHash: { type: String, required: true, trim: true, maxlength: 64 },
  nickname: { type: String, required: true, trim: true, maxlength: 60 },
  message: { type: String, required: true, trim: true, maxlength: 1500 },
  property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", default: null },
  propertyTitle: { type: String, default: "", trim: true, maxlength: 250 },
  deletedAt: { type: Date, default: null },
  deletedByOwner: { type: Boolean, default: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

decisionWorkspaceMessageSchema.index({ workspace: 1, createdAt: -1 });
decisionWorkspaceMessageSchema.index({ workspace: 1, updatedAt: 1 });

module.exports = mongoose.model("DecisionWorkspaceMessage", decisionWorkspaceMessageSchema);
