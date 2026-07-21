const express = require("express");
const { body, query, validationResult } = require("express-validator");
const Property = require("../models/Property");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const { linkProperty, unlinkProperty, relinkProperty } = require("../services/propertyLinkSync");
const { uploadIfBase64, uploadArrayIfBase64 } = require("../utils/mediaUpload");
const { normalizeApartmentPayload, normalizeVillaPayload, normalizePlotPayload, normalizeCommercialPayload, normalizePgPayload, PropertyPayloadError } = require("../utils/propertyPayload");

const router = express.Router();

async function convertPropertyMedia(body) {
  const [image, images, videos, brochure] = await Promise.all([
    uploadIfBase64(body.image, { resourceType: "image", folder: "clear-title/properties" }),
    uploadArrayIfBase64(body.images, { resourceType: "image", folder: "clear-title/properties" }),
    uploadArrayIfBase64(body.videos, { resourceType: "video", folder: "clear-title/properties/videos" }),
    uploadIfBase64(body.brochure, { resourceType: "raw", folder: "clear-title/properties/brochures" }),
  ]);
  return { ...body, image, images, videos, brochure };
}

function normalizeStructuredPayload(body, { requireStructured = false } = {}) {
  if (body.propertyType === "Apartment") return normalizeApartmentPayload(body, { requireStructured });
  if (body.propertyType === "Villa") return normalizeVillaPayload(body, { requireStructured });
  if (body.propertyType === "Plot") return normalizePlotPayload(body, { requireStructured });
  if (body.propertyType === "Commercial") return normalizeCommercialPayload(body, { requireStructured });
  if (body.propertyType === "PG/Co-living") return normalizePgPayload(body, { requireStructured });
  return body;
}

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

    if (city) filter["locality.city"] = String(city);
    if (propertyType) filter.propertyType = String(propertyType);
    if (bedrooms) {
      const b = parseInt(bedrooms);
      if (Number.isInteger(b)) {
        filter.$and = [
          { $or: [
            { bedrooms: b },
            { configurationDetails: { $elemMatch: { bedrooms: b } } },
            { "villaDetails.configurationDetails": { $elemMatch: { bedrooms: b } } },
          ] },
        ];
      }
    }
    if (search) filter.$text = { $search: String(search) };
    if (minPrice || maxPrice) {
      filter.priceValue = {};
      if (minPrice) filter.priceValue.$gte = Number(minPrice);
      if (maxPrice) filter.priceValue.$lte = Number(maxPrice);
    }

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

    if (city) filter["locality.city"] = String(city);
    if (propertyType) filter.propertyType = String(propertyType);
    if (bedrooms) {
      const b = parseInt(bedrooms);
      if (Number.isInteger(b)) {
        filter.$or = [
          { bedrooms: b },
          { configurationDetails: { $elemMatch: { bedrooms: b } } },
          { "villaDetails.configurationDetails": { $elemMatch: { bedrooms: b } } },
        ];
      }
    }
    if (search) filter.$text = { $search: String(search) };
    if (minPrice || maxPrice) {
      filter.priceValue = {};
      if (minPrice) filter.priceValue.$gte = Number(minPrice);
      if (maxPrice) filter.priceValue.$lte = Number(maxPrice);
    }

    const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const skip = (pageNum - 1) * limitNum;
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
        .populate("postedBy", "name phone role")
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
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("List admin properties error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /api/properties/:id ────────────────────────────────
// Get single property (public — only approved/legacy-visible)
router.get("/:id", async (req, res) => {
  try {
    // DBG010: Apply same visibility clause as list route so pending/rejected are not publicly accessible
    const property = await Property.findOne({
      _id: req.params.id,
      $or: [{ status: "approved" }, { status: { $exists: false }, published: { $ne: false } }],
    })
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
    body("price").custom((value, { req }) => {
      if (typeof value === "string" && value.trim()) return true;
      if (req.body.propertyType === "Apartment" && Array.isArray(req.body.configurationDetails)) return true;
      if (req.body.propertyType === "Villa" && Array.isArray(req.body.villaDetails?.configurationDetails)) return true;
      if (req.body.propertyType === "Plot" && Array.isArray(req.body.plotDetails?.plotSizeDetails)) return true;
      if (req.body.propertyType === "Commercial" && req.body.commercialDetails) return true;
      if (req.body.propertyType === "PG/Co-living" && req.body.pgDetails) return true;
      throw new Error("Price is required");
    }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const normalizedBody = normalizeStructuredPayload(req.body, { requireStructured: true });
      const propertyData = {
        ...(await convertPropertyMedia(normalizedBody)),
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
      if (error instanceof PropertyPayloadError) return res.status(400).json({ error: error.message });
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
      const previousLinks = {
        _id: existing._id,
        builderId: existing.builderId,
        dealerId: existing.dealerId,
      };

      const finalType = req.body.propertyType ?? existing.propertyType;
      const converted = await convertPropertyMedia(req.body);
      const hasStructuredApartment = Boolean(existing.configurationDetails?.length) || "configurationDetails" in req.body;
      const hasStructuredVilla = Boolean(existing.villaDetails?.configurationDetails?.length) || "villaDetails" in req.body;
      const hasStructuredPlot = Boolean(existing.plotDetails?.plotSizeDetails?.length) || "plotDetails" in req.body;
      const hasStructuredCommercial = Boolean(existing.commercialDetails) || "commercialDetails" in req.body;
      const hasStructuredPg = Boolean(existing.pgDetails?.sharingDetails?.length) || "pgDetails" in req.body;
      let updates = converted;
      if (finalType === "Apartment" && hasStructuredApartment) {
        updates = normalizeApartmentPayload({ ...existing.toObject(), ...converted }, { requireStructured: true });
      } else if (finalType === "Villa" && hasStructuredVilla) {
        updates = normalizeVillaPayload({ ...existing.toObject(), ...converted }, { requireStructured: true });
      } else if (finalType === "Plot" && hasStructuredPlot) {
        updates = normalizePlotPayload({ ...existing.toObject(), ...converted }, { requireStructured: true });
      } else if (finalType === "Commercial" && hasStructuredCommercial) {
        updates = normalizeCommercialPayload({ ...existing.toObject(), ...converted }, { requireStructured: true });
      } else if (finalType === "PG/Co-living" && hasStructuredPg) {
        updates = normalizePgPayload({ ...existing.toObject(), ...converted }, { requireStructured: true });
      } else if ("propertyType" in req.body && !["Apartment", "Villa", "Plot", "Commercial", "PG/Co-living"].includes(finalType)) {
        updates = {
          ...updates,
          configurationDetails: undefined,
          villaDetails: undefined,
          plotDetails: undefined,
          commercialDetails: undefined,
          pgDetails: undefined,
          possessionDetails: undefined,
          floorLabel: undefined,
          totalFloors: undefined,
        };
      }
      if (finalType === "Apartment" && !hasStructuredApartment) {
        if (req.body.reraRegistered === false) updates = { ...updates, reraNumber: "" };
        if (req.body.transactionType === "Resale") updates = { ...updates, bookingAmount: "" };
      }
      if (finalType === "Villa" && !hasStructuredVilla && req.body.reraRegistered === false) {
        updates = { ...updates, reraNumber: "" };
      }
      if (finalType === "Plot" && !hasStructuredPlot && req.body.reraRegistered === false) {
        updates = { ...updates, reraNumber: "" };
      }
      if (finalType === "Commercial" && !hasStructuredCommercial && req.body.reraRegistered === false) updates = { ...updates, reraNumber: "" };
      existing.set(updates);
      const property = await existing.save();

      if ("builderId" in req.body || "dealerId" in req.body) {
        const nextBuilderId = "builderId" in req.body ? req.body.builderId : previousLinks.builderId;
        const nextDealerId = "dealerId" in req.body ? req.body.dealerId : previousLinks.dealerId;
        await relinkProperty(previousLinks, nextBuilderId, nextDealerId);
      }

      return res.json({
        message: "Property updated successfully",
        property: { ...property.toObject(), id: property._id.toString() },
      });
    } catch (error) {
      if (error.name === "CastError") {
        return res.status(404).json({ error: "Property not found" });
      }
      if (error instanceof PropertyPayloadError) return res.status(400).json({ error: error.message });
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
    body("price").custom((value, { req }) => {
      if (typeof value === "string" && value.trim()) return true;
      if (req.body.propertyType === "Apartment" && Array.isArray(req.body.configurationDetails)) return true;
      if (req.body.propertyType === "Villa" && Array.isArray(req.body.villaDetails?.configurationDetails)) return true;
      if (req.body.propertyType === "Plot" && Array.isArray(req.body.plotDetails?.plotSizeDetails)) return true;
      if (req.body.propertyType === "Commercial" && req.body.commercialDetails) return true;
      if (req.body.propertyType === "PG/Co-living" && req.body.pgDetails) return true;
      throw new Error("Price is required");
    }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const normalizedBody = normalizeStructuredPayload(req.body, { requireStructured: true });
      const propertyData = {
        ...(await convertPropertyMedia(normalizedBody)),
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
      if (error instanceof PropertyPayloadError) return res.status(400).json({ error: error.message });
      console.error("Create public property error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
