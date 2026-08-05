const mongoose = require("mongoose");

const favoritePropertySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  propertyId: { type: mongoose.Schema.Types.ObjectId, ref: "Property", required: true, index: true },
}, { timestamps: true });

favoritePropertySchema.index({ userId: 1, propertyId: 1 }, { unique: true });
favoritePropertySchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("FavoriteProperty", favoritePropertySchema);
