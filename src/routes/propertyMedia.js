const express = require("express");
const { uploadRequestStream, signedAuthenticatedAssetUrl } = require("../utils/mediaUpload");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const propertySubmitterOnly = require("../middleware/propertySubmitterOnly");
const PropertyPosterDocument = require("../models/PropertyPosterDocument");
const { PURPOSES } = require("../models/PropertyPosterDocument");
const {
  PROPERTY_IMAGE_MAX_BYTES,
  PROPERTY_DOCUMENT_MAX_BYTES,
  PROPERTY_WALKTHROUGH_MAX_BYTES,
} = require("../utils/propertyMediaLimits");

const router = express.Router();

const KINDS = {
  image: {
    mime: new Set(["image/jpeg", "image/png", "image/webp"]),
    maxBytes: PROPERTY_IMAGE_MAX_BYTES,
    resourceType: "image",
    folder: "clear-title/properties",
  },
  brochure: {
    mime: new Set(["application/pdf"]),
    maxBytes: PROPERTY_DOCUMENT_MAX_BYTES,
    resourceType: "raw",
    folder: "clear-title/properties/brochures",
  },
  "project-document-pdf": {
    mime: new Set(["application/pdf"]),
    maxBytes: PROPERTY_DOCUMENT_MAX_BYTES,
    resourceType: "raw",
    folder: "clear-title/properties/project-downloads",
    requiresAuth: true,
  },
  "project-document-image": {
    mime: new Set(["image/jpeg", "image/png"]),
    maxBytes: PROPERTY_DOCUMENT_MAX_BYTES,
    resourceType: "image",
    folder: "clear-title/properties/project-downloads",
    requiresAuth: true,
  },
  "project-walkthrough": {
    mime: new Set(["video/mp4"]),
    maxBytes: PROPERTY_WALKTHROUGH_MAX_BYTES,
    resourceType: "video",
    folder: "clear-title/properties/project-downloads",
    requiresAuth: true,
  },
  "layout-map-image": {
    mime: new Set(["image/jpeg", "image/png", "image/webp"]),
    maxBytes: PROPERTY_DOCUMENT_MAX_BYTES,
    resourceType: "image",
    folder: "clear-title/properties/layout-maps",
  },
  "layout-map-pdf": {
    mime: new Set(["application/pdf"]),
    maxBytes: PROPERTY_DOCUMENT_MAX_BYTES,
    resourceType: "raw",
    folder: "clear-title/properties/layout-maps",
  },
  "legal-document-image": {
    mime: new Set(["image/jpeg", "image/png", "image/webp"]),
    maxBytes: 5 * 1024 * 1024,
    resourceType: "image",
    folder: "clear-title/lawyers/documents",
    requiresAdmin: true,
  },
  "legal-document-pdf": {
    mime: new Set(["application/pdf"]),
    maxBytes: 5 * 1024 * 1024,
    resourceType: "raw",
    folder: "clear-title/lawyers/documents",
    requiresAdmin: true,
  },
  "rera-document-image": {
    mime: new Set(["image/jpeg", "image/png"]),
    maxBytes: PROPERTY_DOCUMENT_MAX_BYTES,
    resourceType: "image",
    folder: "clear-title/properties/rera-documents",
    requiresAuth: true,
  },
  "rera-document-pdf": {
    mime: new Set(["application/pdf"]),
    maxBytes: PROPERTY_DOCUMENT_MAX_BYTES,
    resourceType: "raw",
    folder: "clear-title/properties/rera-documents",
    requiresAuth: true,
  },
  "property-verification-document": {
    mime: new Set(["application/pdf", "image/jpeg", "image/png"]),
    maxBytes: 10 * 1024 * 1024,
    folder: "clear-title/property-verification",
    requiresPropertySubmitter: true,
    authenticated: true,
  },
};

router.get("/poster-documents/:documentId/download", auth, async (req, res) => {
  try {
    const document = await PropertyPosterDocument.findById(req.params.documentId).lean();
    if (!document) return res.status(404).json({ error: "Verification document not found" });
    const ownsDocument = req.isPropertyPoster && String(document.posterAccount) === String(req.user._id);
    if (req.user.role !== "admin" && !ownsDocument) return res.status(403).json({ error: "You cannot access this document" });

    const source = signedAuthenticatedAssetUrl(document);
    const upstream = await fetch(source, { redirect: "error" });
    if (!upstream.ok) return res.status(502).json({ error: "Verification document is temporarily unavailable" });
    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.length > 10 * 1024 * 1024) return res.status(413).json({ error: "Verification document exceeds the download limit" });
    res.set("Content-Type", document.mimeType);
    res.set("Content-Length", String(bytes.length));
    res.set("Content-Disposition", `attachment; filename="${String(document.fileName).replace(/[^A-Za-z0-9._ -]/g, "_")}"`);
    res.set("Cache-Control", "private, no-store");
    return res.send(bytes);
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Verification document not found" });
    console.error("Verification document download failed:", error);
    return res.status(500).json({ error: "Unable to download verification document" });
  }
});

router.post("/", (req, res, next) => {
  const rules = KINDS[req.query.kind];
  if (!rules) return res.status(400).json({ error: "Invalid media kind" });
  if (rules.requiresAdmin) return auth(req, res, () => adminOnly(req, res, next));
  if (rules.requiresPropertySubmitter) return auth(req, res, () => propertySubmitterOnly(req, res, next));
  if (rules.requiresAuth) return auth(req, res, next);
  return next();
}, async (req, res) => {
  const rules = KINDS[req.query.kind];
  const mime = String(req.headers["content-type"] || "").split(";")[0].toLowerCase();
  if (!rules.mime.has(mime)) return res.status(415).json({ error: `Unsupported ${req.query.kind} file type` });
  const length = Number(req.headers["content-length"] || 0);
  if (length && length > rules.maxBytes) return res.status(413).json({ error: `File exceeds the ${rules.maxBytes / 1024 / 1024} MB limit` });
  try {
    if (rules.authenticated) {
      const purpose = String(req.query.purpose || "");
      if (!PURPOSES.includes(purpose)) return res.status(400).json({ error: "Invalid verification document purpose" });
      const resourceType = mime === "application/pdf" ? "raw" : "image";
      const asset = await uploadRequestStream(req, {
        ...rules,
        resourceType,
        mime,
        uploadOptions: { type: "authenticated", access_mode: "authenticated" },
        returnAsset: true,
      });
      const fileName = decodeURIComponent(String(req.headers["x-file-name"] || `${purpose}.${asset.format || (resourceType === "raw" ? "pdf" : "jpg")}`)).replace(/[\r\n]/g, "").slice(0, 240);
      const document = await PropertyPosterDocument.create({
        posterAccount: req.user._id,
        purpose,
        publicId: asset.publicId,
        resourceType: asset.resourceType,
        deliveryType: "authenticated",
        version: asset.version,
        format: asset.format,
        mimeType: mime,
        fileName,
        bytes: asset.bytes || length,
      });
      return res.status(201).json({ document: { id: document._id, purpose, fileName, mimeType: mime, bytes: document.bytes } });
    }
    const url = await uploadRequestStream(req, { ...rules, mime });
    return res.status(201).json({ url });
  } catch (error) {
    const status = error.code === "FILE_TOO_LARGE" ? 413 : error.code === "INVALID_FILE_SIGNATURE" ? 415 : 500;
    return res.status(status).json({ error: error.message || "Media upload failed" });
  }
});

module.exports = router;
