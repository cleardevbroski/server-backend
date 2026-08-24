const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      match: [/^[6-9]\d{9}$/, "Please enter a valid 10-digit Indian mobile number"],
    },
    name: {
      type: String,
      default: "",
      trim: true,
    },
    email: {
      type: String,
      default: undefined,
      trim: true,
      lowercase: true,
    },
    passwordHash: { type: String, default: "", select: false },
    resetPasswordTokenHash: { type: String, default: "", select: false },
    resetPasswordExpiresAt: { type: Date, default: null, select: false },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verificationSource: {
      type: String,
      enum: ["unknown", "password", "truecaller"],
      default: "unknown",
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string", $gt: "" } } }
);

module.exports = mongoose.model("User", userSchema);
