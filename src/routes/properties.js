const express = require("express");
const { body, query, validationResult } = require("express-validator");
const Property = require("../models/Property");
const Lead = require("../models/Lead");
const FavoriteProperty = require("../models/FavoriteProperty");
const MediaCleanupJob = require("../models/MediaCleanupJob");
const PropertyPosterDocument = require("../models/PropertyPosterDocument");
const PropertyPosterAccount = require("../models/PropertyPosterAccount");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const propertyOwnerOnly = require("../middleware/propertyOwnerOnly");
const customerOrGuest = require("../middleware/customerOrGuest");
const { linkProperty, unlinkProperty, relinkProperty } = require("../services/propertyLinkSync");
const {
  uploadIfBase64,
  uploadArrayIfBase64,
  collectPropertyMediaAssets,
  deleteCloudinaryAssets,
} = require("../utils/mediaUpload");
const { FACING_ERROR_MESSAGE, FACING_OPTIONS, normalizeApartmentPayload, normalizeVillaPayload, normalizePlotPayload, normalizeCommercialPayload, normalizePgPayload, normalizeKarnatakaReraUrl, PropertyPayloadError } = require("../utils/propertyPayload");
const { normalizePropertySubmissionProfile, PropertySubmissionProfileError } = require("../utils/propertySubmissionProfile");
const { sendPropertySubmissionEmail } = require("../services/emailService");
const { PropertyWorkflowError, buildPropertyReviewReadiness, resolveAdminWorkflowTransition } = require("../services/propertyAdminWorkflow");
const { PROPERTY_DOCUMENT_MAX_BYTES, PROPERTY_WALKTHROUGH_MAX_BYTES } = require("../utils/propertyMediaLimits");

const router = express.Router();
const RETIRED_PROPERTY_TYPES = ["Rent", "Lease"];

function assertPropertyTypeIsSupported(propertyType) {
  if (RETIRED_PROPERTY_TYPES.includes(String(propertyType || "").trim())) {
    throw new PropertyPayloadError("Rent and Lease property types are no longer supported");
  }
}

function assertOptionalVillaFacings(payload) {
  if (payload.propertyType !== "Villa" || !payload.villaDetails) return;
  const details = payload.villaDetails;
  const sharedFacing = String(details.plotFacing || "").trim();
  if (sharedFacing && !FACING_OPTIONS.has(sharedFacing)) {
    throw new PropertyPayloadError(FACING_ERROR_MESSAGE.replace(/^Plot/, "Villa plot"));
  }
  (details.configurationDetails || []).forEach((row, index) => {
    const facing = String(row?.plotFacing || "").trim();
    if (!facing || FACING_OPTIONS.has(facing)) return;
    const label = String(row?.configuration || `Configuration ${index + 1}`).trim();
    throw new PropertyPayloadError(`${label}: ${FACING_ERROR_MESSAGE}`);
  });
}

function concisePropertyValidationError(error) {
  if (error instanceof PropertyPayloadError) return error.message;
  const issue = Object.values(error?.errors || {})[0];
  if (!issue) return "Check the property details and try again";
  if (String(issue.path || "").endsWith("plotFacing")) return FACING_ERROR_MESSAGE;
  return issue.message || "Check the property details and try again";
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
  const converted = { ...body };
  const conversions = [
    ["image", () => uploadIfBase64(body.image, { resourceType: "image", folder: "clear-title/properties" })],
    ["developerLogoUrl", () => uploadIfBase64(body.developerLogoUrl, { resourceType: "image", folder: "clear-title/properties/developers" })],
    ["localityMapImageUrl", () => uploadIfBase64(body.localityMapImageUrl, { resourceType: "image", folder: "clear-title/properties/locality-maps" })],
    ["heroImages", () => uploadArrayIfBase64(body.heroImages, { resourceType: "image", folder: "clear-title/properties/hero" })],
    ["images", () => uploadArrayIfBase64(body.images, { resourceType: "image", folder: "clear-title/properties" })],
    ["brochure", () => uploadIfBase64(body.brochure, { resourceType: "raw", folder: "clear-title/properties/brochures" })],
  ].filter(([field]) => Object.prototype.hasOwnProperty.call(body, field));
  await Promise.all(conversions.map(async ([field, convert]) => {
    converted[field] = await convert();
  }));
  return converted;
}

function normalizeStructuredPayload(body, { requireStructured = false, allowReviewedImportGaps = false } = {}) {
  let normalizedBody = body;
  if (body.heroImages !== undefined) {
    if (!Array.isArray(body.heroImages)) throw new PropertyPayloadError("Main display photos must be an array");
    const heroImages = body.heroImages.map((image) => String(image || "").trim()).filter(Boolean);
    if (heroImages.length > 3) throw new PropertyPayloadError("Project overview supports a maximum of 3 main photos");
    normalizedBody = { ...body, heroImages: [...new Set(heroImages)] };
  }
  if (normalizedBody.propertyType === "Apartment") return normalizeApartmentPayload(normalizedBody, { requireStructured, allowReviewedImportGaps });
  if (normalizedBody.propertyType === "Villa") return normalizeVillaPayload(normalizedBody, { requireStructured });
  if (normalizedBody.propertyType === "Plot") return normalizePlotPayload(normalizedBody, { requireStructured });
  if (normalizedBody.propertyType === "Commercial") return normalizeCommercialPayload(normalizedBody, { requireStructured });
  if (normalizedBody.propertyType === "PG/Co-living") return normalizePgPayload(normalizedBody, { requireStructured });
  return normalizedBody;
}

function withoutWorkflowFields(body) {
  const clean = { ...body };
  for (const key of ["_id", "id", "postedBy", "propertyPoster", "submissionProfile", "status", "published", "verified", "reviewMessages", "workflowHistory", "reviewedBy", "reviewedAt", "publishedAt", "rejectionReason", "submissionVersion", "lastSubmittedAt", "createdAt", "updatedAt", "mediaAssets", "mediaRemovalConfirmed", "bulkImport"]) {
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

function presentSubmissionProfile(profile) {
  if (!profile) return undefined;
  const source = typeof profile.toObject === "function" ? profile.toObject() : profile;
  const presentDocument = (document) => document ? {
    id: String(document.document || document.id || ""),
    purpose: document.purpose,
    fileName: document.fileName,
    mimeType: document.mimeType,
  } : undefined;
  return {
    posterType: source.posterType,
    verifiedEmail: source.verifiedEmail,
    consentAcceptedAt: source.consentAcceptedAt,
    ...(source.posterType === "company" ? { company: {
      ...source.company,
      panDocument: presentDocument(source.company?.panDocument),
      reraDocument: presentDocument(source.company?.reraDocument),
      registrationDocument: presentDocument(source.company?.registrationDocument),
    } } : { individual: {
      ...source.individual,
      panDocument: presentDocument(source.individual?.panDocument),
      aadhaarDocument: presentDocument(source.individual?.aadhaarDocument),
      ownershipDocument: presentDocument(source.individual?.ownershipDocument),
    } }),
  };
}

function presentProperty(property, { includeDocumentUrls = false, includeSubmissionProfile = false, includeReviewReadiness = false, includeWorkflowHistory = false } = {}) {
  const source = typeof property.toObject === "function" ? property.toObject() : property;
  const { heroVideo, videos, virtualTourUrl, mediaAssets, submissionProfile, propertyPoster, workflowHistory, ...visibleProperty } = source;
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
  return {
    ...visibleProperty,
    ...(includeSubmissionProfile ? { submissionProfile: presentSubmissionProfile(submissionProfile), propertyPoster } : {}),
    ...(includeReviewReadiness ? { reviewReadiness: buildPropertyReviewReadiness(source) } : {}),
    ...(includeWorkflowHistory ? { workflowHistory: workflowHistory || [] } : {}),
    id: source._id.toString(),
  };
}

const ownerFilter = (req) => req.isPropertyPoster
  ? { propertyPoster: req.user._id }
  : { postedBy: req.user._id };

async function attachPosterDocuments(documentIds, posterAccount, propertyId) {
  if (!documentIds?.length) return;
  await PropertyPosterDocument.updateMany(
    { _id: { $in: documentIds }, posterAccount, $or: [{ property: null }, { property: propertyId }] },
    { $set: { property: propertyId } },
  );
}

function sendSubmissionNotification(property, account, status) {
  if (!account?.email) return;
  sendPropertySubmissionEmail({
    email: account.email,
    name: account.name,
    propertyTitle: property.title,
    reference: String(property._id).slice(-8).toUpperCase(),
    status,
  }).catch((error) => console.error("Property submission email failed:", error.message));
}

function withMediaLedger(payload, existing) {
  const urls = new Set(existing?.mediaAssets || []);
  for (const asset of collectPropertyMediaAssets(existing ? existing.toObject() : {})) urls.add(asset.url);
  for (const asset of collectPropertyMediaAssets(payload)) urls.add(asset.url);
  return { ...payload, mediaAssets: [...urls] };
}

const PROTECTED_MEDIA_FIELDS = ["image", "heroImages", "images", "developerLogoUrl", "localityMapImageUrl"];

function preserveMediaOnImplicitClear(body, existing, updates) {
  if (body.mediaRemovalConfirmed === true) return updates;
  const safe = { ...updates };
  for (const field of PROTECTED_MEDIA_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const previous = existing[field];
    const next = body[field];
    const hadMedia = Array.isArray(previous) ? previous.some(Boolean) : Boolean(previous);
    const clearsMedia = Array.isArray(next) ? !next.some(Boolean) : !String(next || "").trim();
    if (hadMedia && clearsMedia) delete safe[field];
  }
  return safe;
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

function clearNearbyMapResolutions(nearbyDetails) {
  if (!nearbyDetails || typeof nearbyDetails !== "object") return nearbyDetails;
  return Object.fromEntries(Object.entries(nearbyDetails).map(([category, detail]) => [category, {
    ...detail,
    ...(Array.isArray(detail?.places) ? { places: detail.places.map(({ latitude, longitude, osmId, mapUrl, resolvedAddress, approximateDistanceMeters, ...place }) => place) } : {}),
  }]));
}

function verificationMatchesCoordinates(verification, latitude, longitude) {
  return verification && Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(Number(verification.inputLatitude) - latitude) < 0.0000001
    && Math.abs(Number(verification.inputLongitude) - longitude) < 0.0000001;
}

function reconcileLocationIntegrity(payload, body, existing) {
  if (!body?.locality || typeof body.locality !== "object") return payload;
  const latitude = Number(payload.locality?.latitude);
  const longitude = Number(payload.locality?.longitude);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
  const existingLatitude = Number(existing?.locality?.latitude);
  const existingLongitude = Number(existing?.locality?.longitude);
  const changed = Boolean(existing) && (
    hasCoordinates !== (Number.isFinite(existingLatitude) && Number.isFinite(existingLongitude))
    || (hasCoordinates && (Math.abs(latitude - existingLatitude) >= 0.0000001 || Math.abs(longitude - existingLongitude) >= 0.0000001))
  );
  if (!hasCoordinates || !verificationMatchesCoordinates(payload.locationVerification, latitude, longitude)) {
    payload.locationVerification = undefined;
  }
  if (changed) {
    const nearbySource = payload.nearbyDetails || existing?.nearbyDetails?.toObject?.() || existing?.nearbyDetails;
    payload.nearbyDetails = clearNearbyMapResolutions(nearbySource);
  }
  return payload;
}

function prepareOptionalPropertyPayload(body, existing) {
  const payload = compactPropertyPayload(withoutWorkflowFields(body)) || {};
  if (Array.isArray(payload.reraPhases)) {
    payload.reraPhases = payload.reraPhases.map((phase) => ({
      ...phase,
      reraSiteUrl: normalizeKarnatakaReraUrl(phase?.reraSiteUrl),
    }));
  }
  assertPropertyTypeIsSupported(payload.propertyType);
  assertOptionalVillaFacings(payload);
  return reconcileLocationIntegrity(payload, body, existing);
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
  const compact = prepareOptionalPropertyPayload(body, existing);
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
  // Direct batch imports preserve every official RERA file, including split
  // PDF parts and portal-specific categories that do not exist in the manual
  // upload dropdown. Validate the phase metadata normally, then restore those
  // already-uploaded document records before saving.
  const existingPhases = existing?.reraPhases?.toObject ? existing.reraPhases.toObject() : existing?.toObject?.().reraPhases;
  const importedPhaseDocuments = existing?.bulkImport?.packageKey && Array.isArray(existingPhases)
    ? existingPhases.map((phase) => ({
      _id: phase._id,
      name: phase.name,
      reraNumber: phase.reraNumber,
      reraDocuments: phase.reraDocuments || [],
      projectDocuments: phase.projectDocuments || [],
    }))
    : null;
  if (importedPhaseDocuments) {
    candidate.reraPhases = candidate.reraPhases.map(({ _id, ...phase }) => ({ ...phase, reraDocuments: [], projectDocuments: [] }));
  }
  assertPropertyTypeIsSupported(candidate.propertyType);
  if (existing) {
    delete candidate.heroVideo;
    delete candidate.videos;
    delete candidate.virtualTourUrl;
  }
  const structuredTypes = new Set(["Apartment", "Villa", "Plot", "Commercial", "PG/Co-living"]);
  const incoming = { ...compact, propertyType: compact.propertyType || existing?.propertyType };
  if (hasStructuredDetails(existing ? incoming : candidate)) {
    const normalized = withoutWorkflowFields(normalizeStructuredPayload(candidate, {
      requireStructured: true,
      allowReviewedImportGaps: Boolean(existing?.bulkImport?.packageKey),
    }));
    if (importedPhaseDocuments && Array.isArray(normalized.reraPhases)) {
      normalized.reraPhases = normalized.reraPhases.map((phase) => {
        const source = importedPhaseDocuments.find((item) => item.reraNumber === phase.reraNumber)
          || importedPhaseDocuments.find((item) => item.name === phase.name);
        return source ? { ...phase, ...(source._id ? { _id: source._id } : {}), reraDocuments: source.reraDocuments, projectDocuments: source.projectDocuments } : phase;
      });
    }
    return normalized;
  }
  if (compact.propertyType && !structuredTypes.has(compact.propertyType)) {
    for (const key of ["configurationDetails", "villaDetails", "plotDetails", "commercialDetails", "pgDetails", "rentDetails", "leaseDetails", "possessionDetails"]) {
      candidate[key] = undefined;
    }
    return withoutWorkflowFields(candidate);
  }
  return existing ? compact : withoutWorkflowFields(candidate);
}

async function applyAdminPropertyWorkflow(property, action, admin, note = "") {
  const { current, target } = resolveAdminWorkflowTransition(property, action);
  const readiness = buildPropertyReviewReadiness(property);
  if (action === "publish" && !readiness.canPublish) {
    throw new PropertyWorkflowError(`Cannot publish until these required checks are corrected: ${readiness.blockers.join(", ")}`, 422, readiness);
  }
  if (action === "publish") {
    property.set(prepareSubmittedPropertyPayload(property.toObject(), property));
    property.status = "approved";
    property.published = true;
    property.verified = true;
    property.publishedAt = new Date();
    property.rejectionReason = "";
  } else {
    property.status = target;
    property.published = false;
    property.verified = false;
    property.rejectionReason = action === "reject" ? String(note || "Rejected during admin review").trim().slice(0, 1000) : "";
  }
  property.reviewedBy = admin?._id || admin || null;
  property.reviewedAt = new Date();
  property.workflowHistory.push({
    fromStatus: current,
    toStatus: property.status,
    action,
    note: String(note || "").trim().slice(0, 1000),
    actor: admin?._id || admin || null,
  });
  await property.save();
  return buildPropertyReviewReadiness(property);
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
      status,
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
      status,
      search,
      sort = "-updatedAt",
    } = req.query;

    const filter = {};

    if (city) filter["locality.city"] = String(city);
    if (propertyType) filter.propertyType = String(propertyType);
    if (status) filter.status = String(status);
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
    const mapped = properties.map((property) => presentProperty(property, { includeReviewReadiness: true }));

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

function normalizeBulkPackage(value) {
  const source = value && typeof value === "object" ? value : {};
  const packageName = String(source.packageName || "").trim();
  const packageSize = Number(source.packageSize);
  const packageKey = String(source.packageKey || "").trim();
  const batchName = String(source.batchName || "").trim();
  if (!packageName || packageName.length > 300 || !packageName.toLowerCase().endsWith(".zip")) {
    throw new PropertyPayloadError("A valid ZIP package name is required");
  }
  if (!Number.isSafeInteger(packageSize) || packageSize <= 0 || packageSize > 350 * 1024 * 1024) {
    throw new PropertyPayloadError("ZIP packages must be 350 MB or smaller");
  }
  const expectedKey = `${packageName.toLowerCase()}::${packageSize}`;
  if (packageKey !== expectedKey) throw new PropertyPayloadError("The ZIP package key is invalid");
  return { packageKey, packageName, packageSize, batchName: batchName.slice(0, 300), importedAt: new Date() };
}

// Batch-import preflight. No property or Cloudinary data is changed here.
router.post("/admin/recheck-imports/preflight", auth, adminOnly, async (req, res) => {
  try {
    const packages = Array.isArray(req.body.packages) ? req.body.packages : [];
    if (!packages.length || packages.length > 500) return res.status(400).json({ error: "Supply between 1 and 500 ZIP packages" });
    const normalized = packages.map(normalizeBulkPackage);
    const keys = [...new Set(normalized.map((item) => item.packageKey))];
    const existing = await Property.find({ "bulkImport.packageKey": { $in: keys } })
      .select("title status bulkImport.packageKey")
      .lean();
    return res.json({
      packages: normalized.map((item) => {
        const match = existing.find((property) => property.bulkImport?.packageKey === item.packageKey);
        return { ...item, importedAt: undefined, exists: Boolean(match), propertyId: match ? String(match._id) : "", status: match?.status || "" };
      }),
      newCount: normalized.length - existing.length,
      existingCount: existing.length,
    });
  } catch (error) {
    if (error instanceof PropertyPayloadError) return res.status(400).json({ error: error.message });
    console.error("Preflight recheck imports error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Stores one already-extracted package as a private Recheck property. Media is
// uploaded separately through the existing streamed media endpoint.
router.post("/admin/recheck-imports", auth, adminOnly, async (req, res) => {
  try {
    const bulkImport = normalizeBulkPackage(req.body.package);
    const existing = await Property.findOne({ "bulkImport.packageKey": bulkImport.packageKey });
    if (existing) {
      return res.status(200).json({ message: "Package was already imported", skipped: true, property: presentProperty(existing, { includeDocumentUrls: true }) });
    }
    const normalized = prepareOptionalPropertyPayload(req.body.property || {});
    const propertyData = withMediaLedger({
      ...(await convertPropertyMedia(normalized)),
      status: "recheck",
      published: false,
      verified: false,
      submittedBy: "admin",
      postedBy: req.user._id,
      postedDate: new Date().toISOString(),
      bulkImport,
    });
    const property = await Property.create(propertyData);
    await linkProperty(property);
    return res.status(201).json({ message: "Property imported for recheck", skipped: false, property: presentProperty(property, { includeDocumentUrls: true }) });
  } catch (error) {
    if (error?.code === 11000) {
      const packageKey = String(req.body?.package?.packageKey || "");
      const existing = await Property.findOne({ "bulkImport.packageKey": packageKey });
      if (existing) return res.status(200).json({ message: "Package was already imported", skipped: true, property: presentProperty(existing, { includeDocumentUrls: true }) });
    }
    if (error instanceof PropertyPayloadError || error.name === "ValidationError") return res.status(400).json({ error: concisePropertyValidationError(error) });
    console.error("Create recheck import error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/recheck-imports/:id", auth, adminOnly, async (req, res) => {
  try {
    const action = String(req.body.action || "");
    if (!["move_to_pending", "publish"].includes(action)) return res.status(400).json({ error: "Choose move_to_pending or publish" });
    const property = await Property.findOne({ _id: req.params.id, status: "recheck" });
    if (!property) return res.status(404).json({ error: "Recheck property not found" });
    await applyAdminPropertyWorkflow(property, action, req.user, req.body.note);
    return res.json({ message: action === "publish" ? "Property published" : "Property moved to Pending", property: presentProperty(property, { includeDocumentUrls: true, includeReviewReadiness: true, includeWorkflowHistory: true }) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Recheck property not found" });
    if (error instanceof PropertyWorkflowError) return res.status(error.status).json({ error: error.message, readiness: error.readiness });
    if (error instanceof PropertyPayloadError || error.name === "ValidationError") return res.status(400).json({ error: concisePropertyValidationError(error) });
    console.error("Update recheck property error:", error);
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
    return res.json({ property: presentProperty(property, { includeDocumentUrls: true, includeReviewReadiness: true, includeWorkflowHistory: true }) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Property not found" });
    console.error("Get admin property error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Customer-owned property dashboard.
router.get("/my", auth, propertyOwnerOnly, async (req, res) => {
  try {
    const properties = await Property.find({ ...ownerFilter(req), submittedBy: "user" })
      .select("-videos -brochure")
      .slice("images", 1)
      .sort("-updatedAt")
      .lean();
    return res.json({ properties: properties.map((property) => presentProperty(property, { includeSubmissionProfile: true })) });
  } catch (error) {
    console.error("List customer properties error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/my/:id", auth, propertyOwnerOnly, async (req, res) => {
  try {
    const property = await Property.findOne({ _id: req.params.id, ...ownerFilter(req), submittedBy: "user" }).lean();
    if (!property) return res.status(404).json({ error: "Property not found" });
    return res.json({ property: presentProperty(property, { includeDocumentUrls: true, includeSubmissionProfile: true }) });
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
      .populate("propertyPoster", "name phone email role")
      .sort("-updatedAt")
      .lean();
    return res.json({ properties: properties.map((property) => presentProperty(property, { includeSubmissionProfile: true })) });
  } catch (error) {
    console.error("List public submissions error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/submissions/:id", auth, adminOnly, async (req, res) => {
  try {
    const property = await Property.findOne({ _id: req.params.id, submittedBy: "user" })
      .populate("postedBy", "name phone email")
      .populate("propertyPoster", "name phone email role")
      .populate("reviewMessages.sender", "name role")
      .lean();
    if (!property) return res.status(404).json({ error: "Submission not found" });
    return res.json({ property: presentProperty(property, { includeDocumentUrls: true, includeSubmissionProfile: true }) });
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
        // Revalidate the complete project at approval time and persist any
        // legacy area labels into the canonical square-foot fields.
        property.set(prepareSubmittedPropertyPayload(property.toObject(), property));
        property.status = "published";
        property.verified = true;
        property.published = true;
        property.publishedAt = new Date();
        property.rejectionReason = "";
      }
      property.reviewedBy = req.user._id;
      property.reviewedAt = new Date();
      await property.save();
      if (property.propertyPoster) {
        const poster = await PropertyPosterAccount.findById(property.propertyPoster).lean();
        sendSubmissionNotification(property, poster, property.status);
      }
      return res.json({ message: "Submission updated", property: presentProperty(property, { includeDocumentUrls: true, includeSubmissionProfile: true }) });
    } catch (error) {
      if (error.name === "CastError") return res.status(404).json({ error: "Submission not found" });
      if (error instanceof PropertyPayloadError || error.name === "ValidationError") return res.status(400).json({ error: concisePropertyValidationError(error) });
      console.error("Review public submission error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.put("/my/:id/resubmit", auth, propertyOwnerOnly, async (req, res) => {
  try {
    const property = await Property.findOne({ _id: req.params.id, ...ownerFilter(req), submittedBy: "user" });
    if (!property) return res.status(404).json({ error: "Property not found" });
    if (!["draft", "changes_requested"].includes(property.status)) {
      return res.status(409).json({ error: "This property cannot be resubmitted in its current status" });
    }
    const propertyBody = { ...req.body };
    delete propertyBody.submissionProfile;
    delete propertyBody.locationVerification;
    const normalized = preserveMediaOnImplicitClear(
      propertyBody,
      property,
      prepareSubmittedPropertyPayload(propertyBody, property)
    );
    property.set(withMediaLedger(await convertPropertyMedia(normalized), property));
    let posterProfile;
    if (req.isPropertyPoster && req.body.submissionProfile) {
      posterProfile = await normalizePropertySubmissionProfile(req.body.submissionProfile, req.user, property.submissionProfile, property._id);
      property.submissionProfile = posterProfile.profile;
      req.user.name = posterProfile.displayName;
      req.user.phone = posterProfile.phone;
      await req.user.save();
    }
    property.status = property.status === "draft" ? "submitted" : "resubmitted";
    property.published = false;
    property.verified = false;
    property.submissionVersion += 1;
    property.lastSubmittedAt = new Date();
    property.rejectionReason = "";
    property.reviewMessages.push({ senderRole: "user", sender: req.user._id, message: "Property details updated and resubmitted." });
    await property.save();
    if (posterProfile) await attachPosterDocuments(posterProfile.documentIds, req.user._id, property._id);
    if (req.isPropertyPoster) sendSubmissionNotification(property, req.user, property.status);
    return res.json({ message: "Property resubmitted for review", property: presentProperty(property, { includeDocumentUrls: true, includeSubmissionProfile: true }) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Property not found" });
    if (error instanceof PropertyPayloadError || error instanceof PropertySubmissionProfileError) return res.status(400).json({ error: error.message });
    console.error("Resubmit property error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Customer or manual-guest document download. The permanent Cloudinary
// URL is never included in the public property payload.
router.get("/:id/documents/:phaseId/:documentId/download", auth, customerOrGuest, async (req, res) => {
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
    if (bytes.length > PROPERTY_DOCUMENT_MAX_BYTES) return res.status(413).json({ error: "Document exceeds the download limit" });

    await Lead.create({
      type: "property_interest",
      name: req.user.name,
      email: req.user.email,
      phone: req.user.phone,
      message: `Document download for ${property.title}`,
      propertyId: property._id.toString(),
      propertyTitle: property.title,
      action: "document",
      phaseName: phase.name,
      documentName: document.label,
      verificationSource: req.user.verificationSource || "unknown",
      phoneVerified: Boolean(req.user.isVerified),
      consentAt: req.user.consentAt || null,
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

router.get("/:id/project-downloads/:documentId/download", auth, customerOrGuest, async (req, res) => {
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
    const maxDownloadBytes = document.kind === "walkthrough" ? PROPERTY_WALKTHROUGH_MAX_BYTES : PROPERTY_DOCUMENT_MAX_BYTES;
    if (bytes.length > maxDownloadBytes) return res.status(413).json({ error: "Document exceeds the download limit" });
    await Lead.create({
      type: "property_interest",
      name: req.user.name,
      email: req.user.email,
      phone: req.user.phone,
      message: `${document.kind} download for ${property.title}`,
      propertyId: property._id.toString(),
      propertyTitle: property.title,
      action: "document",
      documentName: document.label,
      verificationSource: req.user.verificationSource || "unknown",
      phoneVerified: Boolean(req.user.isVerified),
      consentAt: req.user.consentAt || null,
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
      const savePending = req.body.status === "pending" || req.body.published === false;
      const normalizedBody = savePending ? prepareOptionalPropertyPayload(req.body) : prepareSubmittedPropertyPayload(req.body);
      const hasTitle = typeof normalizedBody.title === "string" && Boolean(normalizedBody.title.trim());
      const propertyData = withMediaLedger({
        ...(await convertPropertyMedia(normalizedBody)),
        status: savePending || !hasTitle ? "pending" : "approved",
        published: !(savePending || !hasTitle),
        postedBy: req.user._id,
        postedDate: new Date().toISOString(),
      });

      const property = await Property.create(propertyData);
      await linkProperty(property);

      return res.status(201).json({
        message: "Property created successfully",
        property: presentProperty(property, { includeDocumentUrls: true }),
      });
    } catch (error) {
      if (error instanceof PropertyPayloadError || error.name === "ValidationError") return res.status(400).json({ error: concisePropertyValidationError(error) });
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

      const hasExplicitWorkflow = Object.prototype.hasOwnProperty.call(req.body, "status") || Object.prototype.hasOwnProperty.call(req.body, "published");
      const savePending = req.body.status === "pending" || req.body.published === false
        || (!hasExplicitWorkflow && ["pending", "recheck", "rejected"].includes(existing.status));
      const normalizedUpdates = preserveMediaOnImplicitClear(
        req.body,
        existing,
        savePending ? prepareOptionalPropertyPayload(req.body, existing) : prepareSubmittedPropertyPayload(req.body, existing)
      );
      const updates = await convertPropertyMedia(includeAdminWorkflowFields(normalizedUpdates, req.body));
      existing.set(withMediaLedger(updates, existing));
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
      if (error instanceof PropertyPayloadError || error.name === "ValidationError") return res.status(400).json({ error: concisePropertyValidationError(error) });
      console.error("Update property error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Workflow-only mutations never pass through the editable property payload and
// therefore cannot replace or clear project media.
router.patch("/:id/workflow", auth, adminOnly, async (req, res) => {
  try {
    const statusActions = { approved: "publish", published: "publish", pending: "move_to_pending", recheck: "move_to_recheck", rejected: "reject" };
    const requestedAction = String(req.body.action || "").trim();
    const legacyStatusAction = statusActions[String(req.body.status || "").trim()];
    const publishedAction = typeof req.body.published === "boolean" ? req.body.published ? "publish" : "move_to_pending" : "";
    const action = requestedAction || legacyStatusAction || publishedAction;
    const hasFeatured = typeof req.body.featured === "boolean";
    if (!action && !hasFeatured) return res.status(400).json({ error: "Choose a workflow action or supply featured" });
    if (action && !["move_to_recheck", "move_to_pending", "publish", "reject"].includes(action)) {
      return res.status(400).json({ error: "Invalid property workflow action" });
    }
    const property = await Property.findById(req.params.id);
    if (!property) return res.status(404).json({ error: "Property not found" });
    if (hasFeatured) property.featured = req.body.featured;
    const isSameAdminWorkflowState = property.submittedBy !== "user" && (
      (action === "publish" && ["approved", "published"].includes(property.status) && property.published !== false)
      || (action === "move_to_pending" && property.status === "pending" && property.published === false)
      || (action === "move_to_recheck" && property.status === "recheck" && property.published === false)
      || (action === "reject" && property.status === "rejected" && property.published === false)
    );
    if (action && !isSameAdminWorkflowState) await applyAdminPropertyWorkflow(property, action, req.user, req.body.note);
    else await property.save();
    return res.json({
      message: "Property workflow updated",
      property: presentProperty(property, { includeDocumentUrls: true, includeReviewReadiness: true, includeWorkflowHistory: true }),
    });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Property not found" });
    if (error instanceof PropertyWorkflowError) return res.status(error.status).json({ error: error.message, readiness: error.readiness });
    if (error instanceof PropertyPayloadError) return res.status(400).json({ error: concisePropertyValidationError(error) });
    if (error.name === "ValidationError") return res.status(400).json({ error: concisePropertyValidationError(error) });
    console.error("Update property workflow error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /api/properties/:id ─────────────────────────────────
// Delete property (admin only)
router.delete("/:id", auth, adminOnly, async (req, res) => {
  try {
    const property = await Property.findById(req.params.id);

    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    const ownedAssets = collectPropertyMediaAssets({
      property: property.toObject(),
      mediaAssets: property.mediaAssets || [],
    });
    const otherProperties = await Property.find({ _id: { $ne: property._id } }).lean();
    const referencedElsewhere = new Set(
      otherProperties
        .flatMap((item) => collectPropertyMediaAssets(item))
        .map((asset) => `${asset.resourceType}:${asset.publicId}`)
    );
    const exclusiveAssets = ownedAssets.filter(
      (asset) => !referencedElsewhere.has(`${asset.resourceType}:${asset.publicId}`)
    );
    const verificationDocuments = await PropertyPosterDocument.find({ property: property._id }).lean();

    await Property.deleteOne({ _id: property._id });

    await unlinkProperty(property);
    await FavoriteProperty.deleteMany({ propertyId: property._id });

    let mediaCleanup = "not_required";
    if (exclusiveAssets.length) {
      const cleanupJob = await MediaCleanupJob.create({
        propertyId: String(property._id),
        propertyTitle: property.title,
        assets: exclusiveAssets.map(({ publicId, resourceType }) => ({ publicId, resourceType })),
      });
      try {
        await deleteCloudinaryAssets(exclusiveAssets);
        cleanupJob.status = "completed";
        cleanupJob.attempts = 1;
        cleanupJob.completedAt = new Date();
        await cleanupJob.save();
        mediaCleanup = "completed";
      } catch (cleanupError) {
        cleanupJob.attempts = 1;
        cleanupJob.lastError = String(cleanupError.message || cleanupError).slice(0, 1000);
        await cleanupJob.save();
        mediaCleanup = "pending";
        console.error("Property media cleanup pending:", cleanupError);
      }
    }
    if (verificationDocuments.length) {
      try {
        await deleteCloudinaryAssets(verificationDocuments);
        await PropertyPosterDocument.deleteMany({ property: property._id });
        mediaCleanup = mediaCleanup === "pending" ? "pending" : "completed";
      } catch (cleanupError) {
        mediaCleanup = "pending";
        console.error("Property verification document cleanup pending:", cleanupError);
      }
    }

    return res.json({ message: "Property deleted successfully", mediaCleanup });
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
  propertyOwnerOnly,
  async (req, res) => {
    try {
      const propertyBody = { ...req.body };
      delete propertyBody.submissionProfile;
      delete propertyBody.locationVerification;
      const normalizedBody = prepareSubmittedPropertyPayload(propertyBody);
      const posterProfile = req.isPropertyPoster
        ? await normalizePropertySubmissionProfile(req.body.submissionProfile, req.user)
        : null;
      const propertyData = withMediaLedger({
        ...(await convertPropertyMedia(normalizedBody)),
        published: false,
        verified: false,
        status: "submitted",
        ...(req.isPropertyPoster ? { propertyPoster: req.user._id, submissionProfile: posterProfile.profile } : { postedBy: req.user._id }),
        submittedBy: "user",
        lastSubmittedAt: new Date(),
        postedDate: new Date().toISOString(),
      });

      const property = await Property.create(propertyData);
      if (posterProfile) {
        await attachPosterDocuments(posterProfile.documentIds, req.user._id, property._id);
        req.user.name = posterProfile.displayName;
        req.user.phone = posterProfile.phone;
        await req.user.save();
        sendSubmissionNotification(property, req.user, property.status);
      }

      return res.status(201).json({
        message: "Property submitted successfully for admin review",
        property: presentProperty(property, { includeDocumentUrls: true, includeSubmissionProfile: true }),
      });
    } catch (error) {
      if (error instanceof PropertyPayloadError || error instanceof PropertySubmissionProfileError) return res.status(400).json({ error: error.message });
      console.error("Create public property error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post("/draft", auth, propertyOwnerOnly, async (req, res) => {
  try {
    const propertyBody = { ...req.body };
    delete propertyBody.submissionProfile;
    delete propertyBody.locationVerification;
    const normalizedBody = prepareOptionalPropertyPayload(propertyBody);
    const posterProfile = req.isPropertyPoster
      ? await normalizePropertySubmissionProfile(req.body.submissionProfile, req.user)
      : null;
    const property = await Property.create(withMediaLedger({
      ...(await convertPropertyMedia(normalizedBody)),
      published: false,
      verified: false,
      status: "draft",
      ...(req.isPropertyPoster ? { propertyPoster: req.user._id, submissionProfile: posterProfile.profile } : { postedBy: req.user._id }),
      submittedBy: "user",
      postedDate: new Date().toISOString(),
    }));
    if (posterProfile) {
      await attachPosterDocuments(posterProfile.documentIds, req.user._id, property._id);
      req.user.name = posterProfile.displayName;
      req.user.phone = posterProfile.phone;
      await req.user.save();
    }
    return res.status(201).json({ message: "Draft saved", property: presentProperty(property, { includeDocumentUrls: true, includeSubmissionProfile: true }) });
  } catch (error) {
    if (error instanceof PropertyPayloadError || error instanceof PropertySubmissionProfileError) return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
