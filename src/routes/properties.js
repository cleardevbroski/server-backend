const express = require("express");
const { body, query, validationResult } = require("express-validator");
const Property = require("../models/Property");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const customerOnly = require("../middleware/customerOnly");
const { linkProperty, unlinkProperty, relinkProperty } = require("../services/propertyLinkSync");
const { uploadIfBase64, uploadArrayIfBase64 } = require("../utils/mediaUpload");
const { normalizeApartmentPayload, normalizeVillaPayload, normalizePlotPayload, normalizeCommercialPayload, normalizePgPayload, normalizeRentPayload, normalizeLeasePayload, PropertyPayloadError } = require("../utils/propertyPayload");

const router = express.Router();

function assertPhotoOnlyMedia(body) {
  for (const field of ["heroVideo", "videos", "virtualTourUrl"]) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      throw new PropertyPayloadError("Property listings support photos only; video and virtual-tour media are no longer available");
    }
  }
}

async function convertPropertyMedia(body) {
  assertPhotoOnlyMedia(body);
  const [image, developerLogoUrl, localityMapImageUrl, heroImages, images, brochure] = await Promise.all([
    uploadIfBase64(body.image, { resourceType: "image", folder: "clear-title/properties" }),
    uploadIfBase64(body.developerLogoUrl, { resourceType: "image", folder: "clear-title/properties/developers" }),
    uploadIfBase64(body.localityMapImageUrl, { resourceType: "image", folder: "clear-title/properties/locality-maps" }),
    uploadArrayIfBase64(body.heroImages, { resourceType: "image", folder: "clear-title/properties/hero" }),
    uploadArrayIfBase64(body.images, { resourceType: "image", folder: "clear-title/properties" }),
    uploadIfBase64(body.brochure, { resourceType: "raw", folder: "clear-title/properties/brochures" }),
  ]);
  return { ...body, image, developerLogoUrl, localityMapImageUrl, heroImages, images, brochure };
}

function normalizeStructuredPayload(body, { requireStructured = false } = {}) {
  let normalizedBody = body;
  if (body.heroImages !== undefined) {
    if (!Array.isArray(body.heroImages)) throw new PropertyPayloadError("Main display photos must be an array");
    const heroImages = body.heroImages.map((image) => String(image || "").trim()).filter(Boolean);
    if (heroImages.length > 3) throw new PropertyPayloadError("Project overview supports a maximum of 3 main photos");
    normalizedBody = { ...body, heroImages: [...new Set(heroImages)] };
  }
  if (normalizedBody.propertyType === "Apartment") return normalizeApartmentPayload(normalizedBody, { requireStructured });
  if (normalizedBody.propertyType === "Villa") return normalizeVillaPayload(normalizedBody, { requireStructured });
  if (normalizedBody.propertyType === "Plot") return normalizePlotPayload(normalizedBody, { requireStructured });
  if (normalizedBody.propertyType === "Commercial") return normalizeCommercialPayload(normalizedBody, { requireStructured });
  if (normalizedBody.propertyType === "PG/Co-living") return normalizePgPayload(normalizedBody, { requireStructured });
  if (normalizedBody.propertyType === "Rent") return normalizeRentPayload(normalizedBody, { requireStructured });
  if (normalizedBody.propertyType === "Lease") return normalizeLeasePayload(normalizedBody, { requireStructured });
  return normalizedBody;
}

function withoutWorkflowFields(body) {
  const clean = { ...body };
  for (const key of ["_id", "id", "postedBy", "status", "published", "verified", "reviewMessages", "reviewedBy", "reviewedAt", "publishedAt", "rejectionReason", "submissionVersion", "lastSubmittedAt", "createdAt", "updatedAt"]) {
    delete clean[key];
  }
  return clean;
}

function presentProperty(property) {
  const source = typeof property.toObject === "function" ? property.toObject() : property;
  const { heroVideo, videos, virtualTourUrl, ...visibleProperty } = source;
  return { ...visibleProperty, id: source._id.toString() };
}

const publicSubmissionValidation = [
  body("title").trim().notEmpty().withMessage("Title is required"),
  body("price").custom((value, { req }) => {
    if (typeof value === "string" && value.trim()) return true;
    if (req.body.propertyType === "Apartment" && Array.isArray(req.body.configurationDetails)) return true;
    if (req.body.propertyType === "Villa" && Array.isArray(req.body.villaDetails?.configurationDetails)) return true;
    if (req.body.propertyType === "Plot" && Array.isArray(req.body.plotDetails?.plotSizeDetails)) return true;
    if (req.body.propertyType === "Commercial" && req.body.commercialDetails) return true;
    if (req.body.propertyType === "PG/Co-living" && req.body.pgDetails) return true;
    if (req.body.propertyType === "Rent" && req.body.rentDetails) return true;
    if (req.body.propertyType === "Lease" && req.body.leaseDetails) return true;
    throw new Error("Price is required");
  }),
];

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
    filter.$or = [{ status: { $in: ["approved", "published"] } }, { status: { $exists: false }, published: { $ne: false } }];

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
    const mapped = properties.map(presentProperty);

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
        .populate("postedBy", "name phone email role")
        .lean(),
      Property.countDocuments(filter).collation(collation),
    ]);

    // Map _id to id for frontend compatibility
    const mapped = properties.map(presentProperty);

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

// Full listing data for the admin edit form. This is intentionally separate
// from the public single-property route, which hides unpublished submissions.
router.get("/admin/property/:id", auth, adminOnly, async (req, res) => {
  try {
    const property = await Property.findById(req.params.id)
      .populate("postedBy", "name phone email role")
      .lean();
    if (!property) return res.status(404).json({ error: "Property not found" });
    return res.json({ property: presentProperty(property) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Property not found" });
    console.error("Get admin property error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Customer-owned property dashboard.
router.get("/my", auth, customerOnly, async (req, res) => {
  try {
    const properties = await Property.find({ postedBy: req.user._id, submittedBy: "user" })
      .select("-videos -brochure")
      .slice("images", 1)
      .sort("-updatedAt")
      .lean();
    return res.json({ properties: properties.map(presentProperty) });
  } catch (error) {
    console.error("List customer properties error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/my/:id", auth, customerOnly, async (req, res) => {
  try {
    const property = await Property.findOne({ _id: req.params.id, postedBy: req.user._id, submittedBy: "user" }).lean();
    if (!property) return res.status(404).json({ error: "Property not found" });
    return res.json({ property: presentProperty(property) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Property not found" });
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Dedicated admin queue for public submissions.
router.get("/admin/submissions", auth, adminOnly, async (req, res) => {
  try {
    const filter = { submittedBy: "user", status: { $ne: "draft" } };
    if (req.query.status && req.query.status !== "all") filter.status = String(req.query.status);
    const properties = await Property.find(filter)
      .select("-videos -brochure")
      .slice("images", 1)
      .populate("postedBy", "name phone email")
      .sort("-updatedAt")
      .lean();
    return res.json({ properties: properties.map(presentProperty) });
  } catch (error) {
    console.error("List public submissions error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/submissions/:id", auth, adminOnly, async (req, res) => {
  try {
    const property = await Property.findOne({ _id: req.params.id, submittedBy: "user" })
      .populate("postedBy", "name phone email")
      .populate("reviewMessages.sender", "name role")
      .lean();
    if (!property) return res.status(404).json({ error: "Submission not found" });
    return res.json({ property: presentProperty(property) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Submission not found" });
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put(
  "/admin/submissions/:id/review",
  auth,
  adminOnly,
  [
    body("action").isIn(["start_review", "request_changes", "publish", "reject"]),
    body("message").optional().trim().isLength({ max: 2000 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
      const property = await Property.findOne({ _id: req.params.id, submittedBy: "user" });
      if (!property) return res.status(404).json({ error: "Submission not found" });
      const { action } = req.body;
      const message = String(req.body.message || "").trim();
      if (["request_changes", "reject"].includes(action) && !message) {
        return res.status(400).json({ error: "A correction or rejection message is required" });
      }
      if (action === "start_review") property.status = "under_review";
      if (action === "request_changes") {
        property.status = "changes_requested";
        property.reviewMessages.push({ senderRole: "admin", sender: req.user._id, message });
      }
      if (action === "reject") {
        property.status = "rejected";
        property.rejectionReason = message;
        property.reviewMessages.push({ senderRole: "admin", sender: req.user._id, message });
      }
      if (action === "publish") {
        property.status = "published";
        property.verified = true;
        property.published = true;
        property.publishedAt = new Date();
        property.rejectionReason = "";
      }
      property.reviewedBy = req.user._id;
      property.reviewedAt = new Date();
      await property.save();
      return res.json({ message: "Submission updated", property: presentProperty(property) });
    } catch (error) {
      if (error.name === "CastError") return res.status(404).json({ error: "Submission not found" });
      console.error("Review public submission error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.put("/my/:id/resubmit", auth, customerOnly, publicSubmissionValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    const property = await Property.findOne({ _id: req.params.id, postedBy: req.user._id, submittedBy: "user" });
    if (!property) return res.status(404).json({ error: "Property not found" });
    if (!["draft", "changes_requested"].includes(property.status)) {
      return res.status(409).json({ error: "This property cannot be resubmitted in its current status" });
    }
    const normalized = normalizeStructuredPayload(withoutWorkflowFields(req.body), { requireStructured: true });
    property.set(await convertPropertyMedia(normalized));
    property.status = property.status === "draft" ? "submitted" : "resubmitted";
    property.published = false;
    property.verified = false;
    property.submissionVersion += 1;
    property.lastSubmittedAt = new Date();
    property.rejectionReason = "";
    property.reviewMessages.push({ senderRole: "user", sender: req.user._id, message: "Property details updated and resubmitted." });
    await property.save();
    return res.json({ message: "Property resubmitted for review", property: presentProperty(property) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Property not found" });
    if (error instanceof PropertyPayloadError) return res.status(400).json({ error: error.message });
    console.error("Resubmit property error:", error);
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
      $or: [{ status: { $in: ["approved", "published"] } }, { status: { $exists: false }, published: { $ne: false } }],
    })
      .populate("postedBy", "name phone")
      .lean();

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    return res.json({
      property: presentProperty(property),
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
      if (req.body.propertyType === "Rent" && req.body.rentDetails) return true;
      if (req.body.propertyType === "Lease" && req.body.leaseDetails) return true;
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
        property: presentProperty(property),
      });
    } catch (error) {
      if (error instanceof PropertyPayloadError || error.name === "ValidationError") return res.status(400).json({ error: error.message });
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
      assertPhotoOnlyMedia(req.body);
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
      const hasStructuredRent = Boolean(existing.rentDetails) || "rentDetails" in req.body;
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
      } else if (finalType === "Rent" && hasStructuredRent) updates = normalizeRentPayload({ ...existing.toObject(), ...converted }, { requireStructured: true });
      else if ("propertyType" in req.body && !["Apartment", "Villa", "Plot", "Commercial", "PG/Co-living", "Rent"].includes(finalType)) {
        updates = {
          ...updates,
          configurationDetails: undefined,
          villaDetails: undefined,
          plotDetails: undefined,
          commercialDetails: undefined,
          pgDetails: undefined,
          rentDetails: undefined,
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
        property: presentProperty(property),
      });
    } catch (error) {
      if (error.name === "CastError") {
        return res.status(404).json({ error: "Property not found" });
      }
      if (error instanceof PropertyPayloadError || error.name === "ValidationError") return res.status(400).json({ error: error.message });
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
  auth,
  customerOnly,
  publicSubmissionValidation,
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const normalizedBody = normalizeStructuredPayload(withoutWorkflowFields(req.body), { requireStructured: true });
      const propertyData = {
        ...(await convertPropertyMedia(normalizedBody)),
        published: false,
        verified: false,
        status: "submitted",
        postedBy: req.user._id,
        submittedBy: "user",
        lastSubmittedAt: new Date(),
        postedDate: new Date().toISOString(),
      };

      const property = await Property.create(propertyData);

      return res.status(201).json({
        message: "Property submitted successfully for admin review",
        property: presentProperty(property),
      });
    } catch (error) {
      if (error instanceof PropertyPayloadError) return res.status(400).json({ error: error.message });
      console.error("Create public property error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post("/draft", auth, customerOnly, publicSubmissionValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    const normalizedBody = normalizeStructuredPayload(withoutWorkflowFields(req.body), { requireStructured: true });
    const property = await Property.create({
      ...(await convertPropertyMedia(normalizedBody)),
      published: false,
      verified: false,
      status: "draft",
      postedBy: req.user._id,
      submittedBy: "user",
      postedDate: new Date().toISOString(),
    });
    return res.status(201).json({ message: "Draft saved", property: presentProperty(property) });
  } catch (error) {
    if (error instanceof PropertyPayloadError) return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
