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
    if (city) filter["locality.city"] = city;
    if (type) filter.propertyType = type;
    if (bhk) filter.bedrooms = parseInt(bhk);
    if (min || max) {
      filter.priceValue = {};
      if (min) filter.priceValue.$gte = parseInt(min);
      if (max) filter.priceValue.$lte = parseInt(max);
    }

    // Clamp limit — properties embed base64 media, so unbounded pages are a DoS vector
    const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
    const skip = (parseInt(page) - 1) * limitNum;
    // Exact but case-insensitive city/type — request the index collation so the query stays index-backed.
    const collation = city || type ? Property.CI_COLLATION : undefined;

    const [properties, total] = await Promise.all([
      Property.find(filter)
        .collation(collation)
        // Exclude heavy base64 media from list responses; keep first image as cover thumbnail
        .select("-videos -brochure")
        .slice("images", 1)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Property.countDocuments(filter).collation(collation),
    ]);

    const mapped = properties.map((p) => ({ ...p, id: p._id.toString() }));

    return res.json({
      properties: mapped,
      pagination: {
        page: parseInt(page),
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("Search error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
