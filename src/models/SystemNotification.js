const mongoose = require("mongoose");

const systemNotificationSchema = new mongoose.Schema({
  type: { type: String, enum: ["application_error"], default: "application_error", index: true },
  fingerprint: { type: String, required: true, unique: true, select: false },
  title: { type: String, required: true, maxlength: 160 },
  message: { type: String, required: true, maxlength: 500 },
  path: { type: String, default: "/", maxlength: 500 },
  componentStack: { type: String, default: "", maxlength: 2000 },
  occurrences: { type: Number, default: 0, min: 0 },
  unread: { type: Boolean, default: true, index: true },
  firstOccurredAt: { type: Date, default: Date.now },
  lastOccurredAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

systemNotificationSchema.index({ unread: 1, lastOccurredAt: -1 });

module.exports = mongoose.model("SystemNotification", systemNotificationSchema);
