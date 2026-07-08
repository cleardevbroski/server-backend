const express = require("express");
const { body, query, validationResult } = require("express-validator");
const Property = require("../models/Property");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const { linkProperty, unlinkProperty, relinkProperty } = require("../services/propertyLinkSync");

const router = express.Router();

// ─── GET /api/properties ────────────────────────────────────────
// List properties (public, with optional filters & pagination)
router.get("/", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      city,
      propertyType,
      minPrice,
      maxPrice,
      bedrooms,
      search,
      sort = "-createdAt",
    } = req.query;

    const filter = {};

    if (city) filter["locality.city"] = city;
    if (propertyType) filter.propertyType = propertyType;
    if (bedrooms) filter.bedrooms = parseInt(bedrooms);
    if (search) filter.$text = { $search: search };

    // Public search returns only approved listings (legacy docs without status count as approved)
    filter.$or = [{ status: "approved" }, { status: { $exists: false }, published: { $ne: false } }];

    // Clamp limit — properties embed base64 media, so unbounded pages are a DoS vector
    const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
    const skip = (parseInt(page) - 1) * limitNum;
    // city/propertyType are exact but case-insensitive — request the index collation so the query stays index-backed.
    const collation = city || propertyType ? Property.CI_COLLATION : undefined;

    const [properties, total] = await Promise.all([
      Property.find(filter)
        .collation(collation)
        // Exclude heavy base64 media from list responses; keep first image as cover thumbnail
        .select("-videos -brochure")
        .slice("images", 1)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .populate("postedBy", "name phone")
        .lean(),
      Property.countDocuments(filter).collation(collation),
    ]);

    // Map _id to id for frontend compatibility
    const mapped = properties.map((p) => ({
      ...p,
      id: p._id.toString(),
    }));

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
    console.error("List properties error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/properties/admin ──────────────────────────────────
// List properties (admin only, includes unpublished, with optional filters & pagination)
router.get("/admin", auth, adminOnly, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      city,
      propertyType,
      minPrice,
      maxPrice,
      bedrooms,
      search,
      sort = "-createdAt",
    } = req.query;

    const filter = {};

    if (city) filter["locality.city"] = city;
    if (propertyType) filter.propertyType = propertyType;
    if (bedrooms) filter.bedrooms = parseInt(bedrooms);
    if (search) filter.$text = { $search: search };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const collation = city || propertyType ? Property.CI_COLLATION : undefined;

    const [properties, total] = await Promise.all([
      Property.find(filter)
        .collation(collation)
        // Exclude heavy base64 media from list responses; keep first image as cover thumbnail
        .select("-videos -brochure")
        .slice("images", 1)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .populate("postedBy", "name phone")
        .lean(),
      Property.countDocuments(filter).collation(collation),
    ]);

    // Map _id to id for frontend compatibility
    const mapped = properties.map((p) => ({
      ...p,
      id: p._id.toString(),
    }));

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
    console.error("List admin properties error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/properties/:id ────────────────────────────────────
// Get single property (public)
router.get("/:id", async (req, res) => {
  try {
    const property = await Property.findById(req.params.id)
      .populate("postedBy", "name phone")
      .lean();

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    return res.json({
      property: { ...property, id: property._id.toString() },
    });
  } catch (error) {
    // Handle invalid ObjectId format
    if (error.name === "CastError") {
      return res.status(404).json({ error: "Property not found" });
    }
    console.error("Get property error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/properties ───────────────────────────────────────
// Create property (admin only)
router.post(
  "/",
  auth,
  adminOnly,
  [
    body("title").trim().notEmpty().withMessage("Title is required"),
    body("price").trim().notEmpty().withMessage("Price is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const propertyData = {
        ...req.body,
        postedBy: req.user._id,
        postedDate: new Date().toISOString(),
      };

      const property = await Property.create(propertyData);
      await linkProperty(property);

      return res.status(201).json({
        message: "Property created successfully",
        property: { ...property.toObject(), id: property._id.toString() },
      });
    } catch (error) {
      console.error("Create property error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── PUT /api/properties/:id ────────────────────────────────────
// Update property (admin only)
router.put(
  "/:id",
  auth,
  adminOnly,
  [body("title").optional().trim().notEmpty().withMessage("Title cannot be empty")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const existing = await Property.findById(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Property not found" });
      }

      const property = await Property.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });

      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }

      if ("builderId" in req.body || "dealerId" in req.body) {
        const nextBuilderId = "builderId" in req.body ? req.body.builderId : existing.builderId;
        const nextDealerId = "dealerId" in req.body ? req.body.dealerId : existing.dealerId;
        await relinkProperty(existing, nextBuilderId, nextDealerId);
      }

      return res.json({
        message: "Property updated successfully",
        property: { ...property.toObject(), id: property._id.toString() },
      });
    } catch (error) {
      if (error.name === "CastError") {
        return res.status(404).json({ error: "Property not found" });
      }
      console.error("Update property error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── DELETE /api/properties/:id ─────────────────────────────────
// Delete property (admin only)
router.delete("/:id", auth, adminOnly, async (req, res) => {
  try {
    const property = await Property.findByIdAndDelete(req.params.id);

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    await unlinkProperty(property);

    return res.json({ message: "Property deleted successfully" });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(404).json({ error: "Property not found" });
    }
    console.error("Delete property error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /api/properties/public ────────────────────────────────
// Create property (public submission queue)
router.post(
  "/public",
  [
    body("title").trim().notEmpty().withMessage("Title is required"),
    body("price").trim().notEmpty().withMessage("Price is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const propertyData = {
        ...req.body,
        published: false,
        verified: false,
        status: "pending",
        postedBy: null, // Public user
        postedDate: new Date().toISOString(),
      };

      const property = await Property.create(propertyData);

      return res.status(201).json({
        message: "Property submitted successfully and is pending approval",
        property: { ...property.toObject(), id: property._id.toString() },
      });
    } catch (error) {
      console.error("Create public property error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
