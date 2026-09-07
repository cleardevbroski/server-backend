const mongoose = require("mongoose");

const voteSchema = new mongoose.Schema({
  participantId: { type: String, required: true, trim: true, maxlength: 120 },
  nickname: { type: String, required: true, trim: true, maxlength: 60 },
  vote: { type: String, enum: ["prefer", "maybe", "not_preferred"], required: true },
  votedAt: { type: Date, default: Date.now },
}, { _id: false });

const itemSchema = new mongoose.Schema({
  property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", required: true },
  note: { type: String, default: "", trim: true, maxlength: 2000 },
  questions: {
    type: [{ type: String, trim: true, maxlength: 500 }],
    validate: { validator: (value) => !value || value.length <= 20, message: "A property can have at most 20 site-visit questions" },
    default: [],
  },
  votes: {
    type: [voteSchema],
    validate: { validator: (value) => !value || value.length <= 30, message: "A property can have at most 30 family votes" },
    default: [],
  },
  addedAt: { type: Date, default: Date.now },
}, { _id: false });

const decisionWorkspaceSchema = new mongoose.Schema({
  title: { type: String, trim: true, maxlength: 120, default: "Our home shortlist" },
  ownerTokenHash: { type: String, required: true, unique: true, select: false },
  shareTokenHash: { type: String, required: true, unique: true, select: false },
  items: {
    type: [itemSchema],
    validate: { validator: (value) => !value || value.length <= 3, message: "A workspace can compare at most 3 properties" },
    default: [],
  },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  lastOpenedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model("DecisionWorkspace", decisionWorkspaceSchema);
