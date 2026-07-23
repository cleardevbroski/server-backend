const mongoose = require("mongoose");

const loginAuditSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    phone: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    role: { type: String, enum: ["user", "admin", ""], default: "" },
    method: { type: String, enum: ["otp_requested", "otp", "password", "password_registration", "truecaller"], required: true },
    status: { type: String, enum: ["success", "failed"], required: true },
    ipAddress: { type: String, default: "" },
    userAgent: { type: String, default: "", maxlength: 500 },
  },
  { timestamps: true }
);

loginAuditSchema.index({ createdAt: -1 });
loginAuditSchema.index({ phone: 1, createdAt: -1 });

module.exports = mongoose.model("LoginAudit", loginAuditSchema);
