const express = require("express");
const { body, query, validationResult } = require("express-validator");
const Property = require("../models/Property");
const Lead = require("../models/Lead");
const FavoriteProperty = require("../models/FavoriteProperty");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const customerOnly = require("../middleware/customerOnly");
const { linkProperty, unlinkProperty, relinkProperty } = require("../services/propertyLinkSync");
const { uploadIfBase64, uploadArrayIfBase64 } = require("../utils/mediaUpload");
const { normalizeApartmentPayload, normalizeVillaPayload, normalizePlotPayload, normalizeCommercialPayload, normalizePgPayload, PropertyPayloadError } = require("../utils/propertyPayload");

const router = express.Router();
const RETIRED_PROPERTY_TYPES = ["Rent", "Lease"];

function assertPropertyTypeIsSupported(propertyType) {
  if (RETIRED_PROPERTY_TYPES.includes(String(propertyType || "").trim())) {
    throw new PropertyPayloadError("Rent and Lease property types are no longer supported");
  }
}

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
  return normalizedBody;
}

function withoutWorkflowFields(body) {
  const clean = { ...body };
  for (const key of ["_id", "id", "postedBy", "status", "published", "verified", "reviewMessages", "reviewedBy", "reviewedAt", "publishedAt", "rejectionReason", "submissionVersion", "lastSubmittedAt", "createdAt", "updatedAt"]) {
    delete clean[key];
  }
  delete clean.maintenanceCharges;
  delete clean.maintenancePeriod;
  delete clean.dealerId;
  if (clean.rentDetails) {
    clean.rentDetails = { ...clean.rentDetails };
    delete clean.rentDetails.maintenanceMode;
    delete clean.rentDetails.maintenanceAmount;
  }
  if (clean.leaseDetails) {
    clean.leaseDetails = { ...clean.leaseDetails };
    delete clean.leaseDetails.camCharges;
  }
  return clean;
}

function presentProperty(property, { includeDocumentUrls = false } = {}) {
  const source = typeof property.toObject === "function" ? property.toObject() : property;
  const { heroVideo, videos, virtualTourUrl, ...visibleProperty } = source;
  if (!includeDocumentUrls && Array.isArray(visibleProperty.reraPhases)) {
    visibleProperty.reraPhases = visibleProperty.reraPhases.map((phase) => ({
      ...phase,
      reraDocuments: (phase.reraDocuments || []).map(({ fileUrl, ...document }) => document),
      projectDocuments: (phase.projectDocuments || []).map(({ fileUrl, ...document }) => document),
    }));
  }
  if (!includeDocumentUrls && Array.isArray(visibleProperty.projectDownloads)) {
    visibleProperty.projectDownloads = visibleProperty.projectDownloads.map(({ fileUrl, ...document }) => document);
  }
  return { ...visibleProperty, id: source._id.toString() };
}

function compactPropertyPayload(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    const entries = value.map(compactPropertyPayload).filter((item) => item !== undefined);
    return entries.length ? entries : undefined;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, compactPropertyPayload(item)])
      .filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value;
}

function parsePrice(value) {
  const text = String(value || "").replace(/,/g, "");
  const match = text.match(/(\d+(?:\.\d+)?)/);
  if (!match) return Number.NaN;
  const amount = Number(match[1]);
  if (/\b(cr|crore)\b/i.test(text)) return amount * 10_000_000;
  if (/\b(l|lac|lakh)\b/i.test(text)) return amount * 100_000;
  return amount;
}

function parseArea(value) {
  const match = String(value || "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : Number.NaN;
}

function localityName(property) {
  const value = property.locality?.landmark || property.locality?.address || property.subtitle || "";
  return String(value).split(",")[0].trim();
}

function propertyPricePerSqft(property) {
  if (property.propertyType === "PG/Co-living") {
    const rents = (property.pgDetails?.sharingDetails || [])
      .map((row) => Number(row.rentPerBed))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (rents.length) return rents.reduce((total, value) => total + value, 0) / rents.length;
  }
  if (property.propertyType === "Plot") {
    const plotRates = (property.plotDetails?.plotSizeDetails || [])
      .map((row) => Number(row.pricePerSqft))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (plotRates.length) return plotRates.reduce((total, value) => total + value, 0) / plotRates.length;
  }
  const direct = parsePrice(property.pricePerSqft);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const rows = property.propertyType === "Villa"
    ? property.villaDetails?.configurationDetails || []
    : property.configurationDetails || [];
  const values = rows.map((row) => {
    const price = parsePrice(row.price);
    const area = parseArea(row.builtUpArea || row.superArea || row.plotArea || row.carpetArea);
    return price > 0 && area > 0 ? price / area : Number.NaN;
  }).filter(Number.isFinite);
  if (values.length) return values.reduce((total, value) => total + value, 0) / values.length;
  const price = parsePrice(property.price);
  const area = parseArea(
    property.commercialDetails?.builtUpArea
      || property.commercialDetails?.superArea
      || property.commercialDetails?.carpetArea
      || property.area,
  );
  return price > 0 && area > 0 ? price / area : Number.NaN;
}

function prepareOptionalPropertyPayload(body) {
  const payload = compactPropertyPayload(withoutWorkflowFields(body)) || {};
  assertPropertyTypeIsSupported(payload.propertyType);
  return payload;
}

function hasStructuredDetails(body) {
  switch (body.propertyType) {
    case "Apartment": return Array.isArray(body.configurationDetails);
    case "Villa": return Array.isArray(body.villaDetails?.configurationDetails);
    case "Plot": return Array.isArray(body.plotDetails?.plotSizeDetails);
    case "Commercial": return Boolean(body.commercialDetails?.commercialSubtype);
    case "PG/Co-living": return Array.isArray(body.pgDetails?.sharingDetails);
    default: return false;
  }
}

/** Sparse submissions remain allowed, but once a structured workflow is
 * present it is normalized and validated as a complete unit. */
function prepareSubmittedPropertyPayload(body, existing) {
  const compact = prepareOptionalPropertyPayload(body);
  if (Object.prototype.hasOwnProperty.call(body, "builderId")) compact.builderId = body.builderId || null;
  if (Object.prototype.hasOwnProperty.call(body, "homepageSections")) {
    if (!Array.isArray(body.homepageSections)) {
      throw new PropertyPayloadError("Homepage sections must be an array");
    }
    compact.homepageSections = [...new Set(body.homepageSections.map(String))];
  }
  const candidate = existing
    ? { ...withoutWorkflowFields(existing.toObject()), ...compact, propertyType: compact.propertyType || existing.propertyType }
    : compact;
  assertPropertyTypeIsSupported(candidate.propertyType);
  if (existing) {
    delete candidate.heroVideo;
    delete candidate.videos;
    delete candidate.virtualTourUrl;
  }
  const structuredTypes = new Set(["Apartment", "Villa", "Plot", "Commercial", "PG/Co-living"]);
  const incoming = { ...compact, propertyType: compact.propertyType || existing?.propertyType };
  if (hasStructuredDetails(existing ? incoming : candidate)) {
    return withoutWorkflowFields(normalizeStructuredPayload(candidate, { requireStructured: true }));
  }
  if (compact.propertyType && !structuredTypes.has(compact.propertyType)) {
    for (const key of ["configurationDetails", "villaDetails", "plotDetails", "commercialDetails", "pgDetails", "rentDetails", "leaseDetails", "possessionDetails"]) {
      candidate[key] = undefined;
    }
    return withoutWorkflowFields(candidate);
  }
  return existing ? compact : withoutWorkflowFields(candidate);
}

function includeAdminWorkflowFields(payload, body) {
  const updates = { ...payload };
  for (const key of ["status", "published", "verified"]) {
    if (Object.prototype.hasOwnProperty.call(body, key)) updates[key] = body[key];
  }
  return updates;
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

    const filter = { propertyType: { $nin: RETIRED_PROPERTY_TYPES } };

    if (city) filter["locality.city"] = String(city);
    if (propertyType) {
      if (RETIRED_PROPERTY_TYPES.includes(String(propertyType))) {
        return res.json({ properties: [], pagination: { page: parseInt(page), limit: Math.min(Math.max(parseInt(limit) || 20, 1), 100), total: 0, pages: 0 } });
      }
      filter.propertyType = String(propertyType);
    }
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
    return res.json({ property: presentProperty(property, { includeDocumentUrls: true }) });
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
    return res.json({ property: presentProperty(property, { includeDocumentUrls: true }) });
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
    return res.json({ property: presentProperty(property, { includeDocumentUrls: true }) });
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
      return res.json({ message: "Submission updated", property: presentProperty(property, { includeDocumentUrls: true }) });
    } catch (error) {
      if (error.name === "CastError") return res.status(404).json({ error: "Submission not found" });
      console.error("Review public submission error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.put("/my/:id/resubmit", auth, customerOnly, async (req, res) => {
  try {
    const property = await Property.findOne({ _id: req.params.id, postedBy: req.user._id, submittedBy: "user" });
    if (!property) return res.status(404).json({ error: "Property not found" });
    if (!["draft", "changes_requested"].includes(property.status)) {
      return res.status(409).json({ error: "This property cannot be resubmitted in its current status" });
    }
    const normalized = prepareSubmittedPropertyPayload(req.body, property);
    property.set(await convertPropertyMedia(normalized));
    property.status = property.status === "draft" ? "submitted" : "resubmitted";
    property.published = false;
    property.verified = false;
    property.submissionVersion += 1;
    property.lastSubmittedAt = new Date();
    property.rejectionReason = "";
    property.reviewMessages.push({ senderRole: "user", sender: req.user._id, message: "Property details updated and resubmitted." });
    await property.save();
    return res.json({ message: "Property resubmitted for review", property: presentProperty(property, { includeDocumentUrls: true }) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Property not found" });
    if (error instanceof PropertyPayloadError) return res.status(400).json({ error: error.message });
    console.error("Resubmit property error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// OTP-authenticated RERA/project document download. The permanent Cloudinary
// URL is never included in the public property payload.
router.get("/:id/documents/:phaseId/:documentId/download", auth, customerOnly, async (req, res) => {
  try {
    if (!req.user.name || !req.user.email) {
      return res.status(400).json({ error: "Complete your name and email before downloading documents" });
    }
    const property = await Property.findOne({
      _id: req.params.id,
      propertyType: { $nin: RETIRED_PROPERTY_TYPES },
      $or: [{ status: { $in: ["approved", "published"] } }, { status: { $exists: false }, published: { $ne: false } }],
    });
    if (!property) return res.status(404).json({ error: "Property not found" });
    const phase = property.reraPhases.id(req.params.phaseId);
    if (!phase) return res.status(404).json({ error: "RERA phase not found" });
    const document = phase.reraDocuments.id(req.params.documentId) || phase.projectDocuments.id(req.params.documentId);
    if (!document) return res.status(404).json({ error: "Document not found" });

    const source = new URL(document.fileUrl);
    if (source.protocol !== "https:" || source.hostname !== "res.cloudinary.com") {
      return res.status(409).json({ error: "Document storage location is invalid" });
    }
    const upstream = await fetch(source, { redirect: "error" });
    if (!upstream.ok) return res.status(502).json({ error: "Document is temporarily unavailable" });
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.length > 15 * 1024 * 1024) return res.status(413).json({ error: "Document exceeds the download limit" });

    await Lead.create({
      type: "property_interest",
      name: req.user.name,
      email: req.user.email,
      phone: req.user.phone,
      message: `Verified document download for ${property.title}`,
      propertyId: property._id.toString(),
      propertyTitle: property.title,
      action: "document",
      phaseName: phase.name,
      documentName: document.label,
    });

    const safeName = String(document.fileName || `${document.key}.pdf`).replace(/[^A-Za-z0-9._ -]/g, "_");
    res.set("Content-Type", document.mimeType);
    res.set("Content-Length", String(bytes.length));
    res.set("Content-Disposition", `attachment; filename="${safeName}"`);
    res.set("Cache-Control", "private, no-store");
    return res.send(bytes);
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Property document not found" });
    console.error("Download property document error:", error);
    return res.status(500).json({ error: "Unable to download document" });
  }
});

router.get("/:id/project-downloads/:documentId/download", auth, customerOnly, async (req, res) => {
  try {
    if (!req.user.name || !req.user.email) {
      return res.status(400).json({ error: "Complete your name and email before downloading documents" });
    }
    const property = await Property.findOne({
      _id: req.params.id,
      propertyType: { $nin: RETIRED_PROPERTY_TYPES },
      $or: [{ status: { $in: ["approved", "published"] } }, { status: { $exists: false }, published: { $ne: false } }],
    });
    if (!property) return res.status(404).json({ error: "Property not found" });
    const document = property.projectDownloads.id(req.params.documentId);
    if (!document) return res.status(404).json({ error: "Project download not found" });
    const source = new URL(document.fileUrl);
    if (source.protocol !== "https:" || source.hostname !== "res.cloudinary.com") {
      return res.status(409).json({ error: "Document storage location is invalid" });
    }
    const upstream = await fetch(source, { redirect: "error" });
    if (!upstream.ok) return res.status(502).json({ error: "Document is temporarily unavailable" });
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.length > 15 * 1024 * 1024) return res.status(413).json({ error: "Document exceeds the download limit" });
    await Lead.create({
      type: "property_interest",
      name: req.user.name,
      email: req.user.email,
      phone: req.user.phone,
      message: `Verified ${document.kind} download for ${property.title}`,
      propertyId: property._id.toString(),
      propertyTitle: property.title,
      action: "document",
      documentName: document.label,
    });
    const safeName = String(document.fileName || `${document.kind}.pdf`).replace(/[^A-Za-z0-9._ -]/g, "_");
    res.set("Content-Type", document.mimeType);
    res.set("Content-Length", String(bytes.length));
    res.set("Content-Disposition", `attachment; filename="${safeName}"`);
    res.set("Cache-Control", "private, no-store");
    return res.send(bytes);
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Project download not found" });
    console.error("Download project file error:", error);
    return res.status(500).json({ error: "Unable to download document" });
  }
});

// ─── GET /api/properties/price-comparison/:id ───────────────
// Derived at request time from currently visible listings, so newly published
// projects automatically affect the locality averages without altering prices.
router.get("/price-comparison/:id", async (req, res) => {
  try {
    const visible = { $or: [{ status: { $in: ["approved", "published"] } }, { status: { $exists: false }, published: { $ne: false } }] };
    const target = await Property.findOne({ _id: req.params.id, propertyType: { $nin: RETIRED_PROPERTY_TYPES }, ...visible }).lean();
    if (!target) return res.status(404).json({ error: "Property not found" });
    const targetLocation = localityName(target);
    if (!targetLocation) return res.json({ currentLocation: "", comparisons: [] });
    const filter = { propertyType: target.propertyType, ...visible };
    if (target.listingType) filter.listingType = target.listingType;
    if (target.locality?.city) filter["locality.city"] = target.locality.city;
    const projects = await Property.find(filter)
      .select("propertyType listingType price pricePerSqft area subtitle locality configurationDetails villaDetails plotDetails commercialDetails pgDetails")
      .lean();
    const groups = new Map();
    projects.forEach((project) => {
      const location = localityName(project);
      const pricePerSqft = propertyPricePerSqft(project);
      if (!location || !Number.isFinite(pricePerSqft) || pricePerSqft <= 0) return;
      const group = groups.get(location.toLowerCase()) || { location, values: [] };
      group.values.push(pricePerSqft);
      groups.set(location.toLowerCase(), group);
    });
    const currentKey = targetLocation.toLowerCase();
    const comparisons = [...groups.entries()].map(([key, group]) => ({
      key,
      location: group.location,
      averagePricePerSqft: Math.round(group.values.reduce((sum, value) => sum + value, 0) / group.values.length),
      projectCount: group.values.length,
    }));
    const current = comparisons.find((item) => item.key === currentKey);
    const closest = comparisons.filter((item) => item.key !== currentKey)
      .sort((a, b) => Math.abs(a.averagePricePerSqft - (current?.averagePricePerSqft || 0)) - Math.abs(b.averagePricePerSqft - (current?.averagePricePerSqft || 0)))
      .slice(0, 4);
    return res.json({ comparisonMetric: target.propertyType === "PG/Co-living" ? "monthlyRentPerBed" : "pricePerSqft", currentLocation: targetLocation, comparisons: current ? [current, ...closest] : closest });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Property not found" });
    console.error("Property price comparison error:", error);
    return res.status(500).json({ error: "Unable to calculate location price comparison" });
  }
});

// ─── GET /api/properties/:id ────────────────────────────────
// Get single property (public — only approved/legacy-visible)
router.get("/:id", async (req, res) => {
  try {
    // DBG010: Apply same visibility clause as list route so pending/rejected are not publicly accessible
    const property = await Property.findOne({
      _id: req.params.id,
      propertyType: { $nin: RETIRED_PROPERTY_TYPES },
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
  async (req, res) => {
    try {
      const normalizedBody = prepareSubmittedPropertyPayload(req.body);
      const hasTitle = typeof normalizedBody.title === "string" && Boolean(normalizedBody.title.trim());
      const propertyData = {
        ...(await convertPropertyMedia(normalizedBody)),
        ...(!hasTitle ? { status: "pending", published: false } : {}),
        postedBy: req.user._id,
        postedDate: new Date().toISOString(),
      };

      const property = await Property.create(propertyData);
      await linkProperty(property);

      return res.status(201).json({
        message: "Property created successfully",
        property: presentProperty(property, { includeDocumentUrls: true }),
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
  async (req, res) => {
    try {
      assertPhotoOnlyMedia(req.body);

      const existing = await Property.findById(req.params.id);
      if (!existing) {
        return res.status(404).json({ error: "Property not found" });
      }
      const previousLinks = {
        _id: existing._id,
        builderId: existing.builderId,
      };

      const normalizedUpdates = prepareSubmittedPropertyPayload(req.body, existing);
      const updates = await convertPropertyMedia(includeAdminWorkflowFields(normalizedUpdates, req.body));
      existing.set(updates);
      const property = await existing.save();

      if ("builderId" in req.body) {
        const nextBuilderId = "builderId" in req.body ? req.body.builderId : previousLinks.builderId;
        await relinkProperty(previousLinks, nextBuilderId);
      }

      return res.json({
        message: "Property updated successfully",
        property: presentProperty(property, { includeDocumentUrls: true }),
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
    await FavoriteProperty.deleteMany({ propertyId: property._id });

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
  async (req, res) => {
    try {
      const normalizedBody = prepareSubmittedPropertyPayload(req.body);
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
        property: presentProperty(property, { includeDocumentUrls: true }),
      });
    } catch (error) {
      if (error instanceof PropertyPayloadError) return res.status(400).json({ error: error.message });
      console.error("Create public property error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post("/draft", auth, customerOnly, async (req, res) => {
  try {
    const normalizedBody = prepareOptionalPropertyPayload(req.body);
    const property = await Property.create({
      ...(await convertPropertyMedia(normalizedBody)),
      published: false,
      verified: false,
      status: "draft",
      postedBy: req.user._id,
      submittedBy: "user",
      postedDate: new Date().toISOString(),
    });
    return res.status(201).json({ message: "Draft saved", property: presentProperty(property, { includeDocumentUrls: true }) });
  } catch (error) {
    if (error instanceof PropertyPayloadError) return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
