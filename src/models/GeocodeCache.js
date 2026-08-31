const mongoose = require("mongoose");

const geocodeCacheSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, trim: true },
  kind: { type: String, enum: ["nearby-search", "project-reverse"], required: true },
  result: { type: mongoose.Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

geocodeCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("GeocodeCache", geocodeCacheSchema);
