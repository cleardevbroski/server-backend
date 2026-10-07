const mongoose = require("mongoose");

const accountSchema = new mongoose.Schema({
  url: { type: String, trim: true, default: "" },
  enabled: { type: Boolean, default: false },
}, { _id: false });

const socialSettingsSchema = new mongoose.Schema({
  key: { type: String, default: "default", unique: true, immutable: true },
  instagram: { type: accountSchema, default: () => ({ url: "https://www.instagram.com/cleartitleone/", enabled: true }) },
  facebook: { type: accountSchema, default: () => ({ url: "https://www.facebook.com/share/1ERpoj3anx/?mibextid=wwXIfr", enabled: true }) },
  youtube: { type: accountSchema, default: () => ({}) },
  linkedin: { type: accountSchema, default: () => ({}) },
  twitter: { type: accountSchema, default: () => ({}) },
  whatsapp: { type: accountSchema, default: () => ({}) },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

module.exports = mongoose.model("SocialSettings", socialSettingsSchema);
