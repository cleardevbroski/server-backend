const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const customerOnly = require("../middleware/customerOnly");
const FavoriteProperty = require("../models/FavoriteProperty");
const Property = require("../models/Property");

const router = express.Router();
const visibleProperty = {
  $or: [
    { status: { $in: ["approved", "published"] } },
    { status: { $exists: false }, published: { $ne: false } },
  ],
};

function validPropertyId(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.propertyId)) return res.status(404).json({ error: "Property not found" });
  next();
}

router.use(auth, customerOnly);

router.get("/ids", async (req, res) => {
  try {
    const favorites = await FavoriteProperty.find({ userId: req.user._id }).select("propertyId -_id").lean();
    const candidateIds = favorites.map((favorite) => favorite.propertyId);
    const properties = await Property.find({ _id: { $in: candidateIds }, ...visibleProperty }).select("_id").lean();
    return res.json({ propertyIds: properties.map((property) => property._id.toString()) });
  } catch (error) {
    console.error("Favorite IDs error:", error);
    return res.status(500).json({ error: "Unable to load saved properties" });
  }
});

router.get("/", async (req, res) => {
  try {
    const favorites = await FavoriteProperty.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
    const orderedIds = favorites.map((favorite) => favorite.propertyId);
    const properties = await Property.find({ _id: { $in: orderedIds }, ...visibleProperty })
      .select("title subtitle price pricePerSqft configs area propertyType builder image heroImages images badges possession possessionDetails reraRegistered status published")
      .slice("heroImages", 1)
      .slice("images", 1)
      .lean();
    const byId = new Map(properties.map((property) => [property._id.toString(), property]));
    return res.json({
      properties: orderedIds.map((id) => byId.get(id.toString())).filter(Boolean).map((property) => ({ ...property, id: property._id.toString() })),
    });
  } catch (error) {
    console.error("Favorites list error:", error);
    return res.status(500).json({ error: "Unable to load saved properties" });
  }
});

router.post("/:propertyId", validPropertyId, async (req, res) => {
  try {
    const property = await Property.exists({ _id: req.params.propertyId, ...visibleProperty });
    if (!property) return res.status(404).json({ error: "Property not found or is no longer available" });
    const result = await FavoriteProperty.updateOne(
      { userId: req.user._id, propertyId: req.params.propertyId },
      { $setOnInsert: { userId: req.user._id, propertyId: req.params.propertyId } },
      { upsert: true },
    );
    return res.status(result.upsertedCount ? 201 : 200).json({ message: "Property saved", propertyId: req.params.propertyId });
  } catch (error) {
    console.error("Save favorite error:", error);
    return res.status(500).json({ error: "Unable to save property" });
  }
});

router.delete("/:propertyId", validPropertyId, async (req, res) => {
  try {
    await FavoriteProperty.deleteOne({ userId: req.user._id, propertyId: req.params.propertyId });
    return res.json({ message: "Property removed from saved properties", propertyId: req.params.propertyId });
  } catch (error) {
    console.error("Remove favorite error:", error);
    return res.status(500).json({ error: "Unable to remove saved property" });
  }
});

module.exports = router;
