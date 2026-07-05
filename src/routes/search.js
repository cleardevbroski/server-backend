const express = require("express");
const rateLimit = require("express-rate-limit");
const Property = require("../models/Property");

const router = express.Router();

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many search requests. Please slow down." },
});

// GET /api/search (public)
router.get("/", searchLimiter, async (req, res) => {
  try {
    const { q, city, type, min, max, bhk, sort = "-createdAt", page = 1, limit = 20 } = req.query;

    const filter = {};
    if (q) filter.$text = { $search: q };
    if (city) filter["locality.city"] = new RegExp(city, "i");
    if (type) filter.propertyType = new RegExp(type, "i");
    if (bhk) filter.bedrooms = parseInt(bhk);
    if (min || max) {
      filter.priceValue = {};
      if (min) filter.priceValue.$gte = parseInt(min);
      if (max) filter.priceValue.$lte = parseInt(max);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [properties, total] = await Promise.all([
      Property.find(filter).sort(sort).skip(skip).limit(parseInt(limit)).lean(),
      Property.countDocuments(filter),
    ]);

    const mapped = properties.map((p) => ({ ...p, id: p._id.toString() }));

    return res.json({
      properties: mapped,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Search error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
