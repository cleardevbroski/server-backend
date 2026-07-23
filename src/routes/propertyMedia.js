const express = require("express");
const { uploadRequestStream } = require("../utils/mediaUpload");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");

const router = express.Router();

const KINDS = {
  image: {
    mime: new Set(["image/jpeg", "image/png", "image/webp"]),
    maxBytes: 5 * 1024 * 1024,
    resourceType: "image",
    folder: "clear-title/properties",
  },
  brochure: {
    mime: new Set(["application/pdf"]),
    maxBytes: 5 * 1024 * 1024,
    resourceType: "raw",
    folder: "clear-title/properties/brochures",
  },
  "layout-map-image": {
    mime: new Set(["image/jpeg", "image/png", "image/webp"]),
    maxBytes: 5 * 1024 * 1024,
    resourceType: "image",
    folder: "clear-title/properties/layout-maps",
  },
  "layout-map-pdf": {
    mime: new Set(["application/pdf"]),
    maxBytes: 5 * 1024 * 1024,
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
};

router.post("/", (req, res, next) => {
  const rules = KINDS[req.query.kind];
  if (!rules) return res.status(400).json({ error: "Invalid media kind" });
  if (!rules.requiresAdmin) return next();
  return auth(req, res, () => adminOnly(req, res, next));
}, async (req, res) => {
  const rules = KINDS[req.query.kind];
  const mime = String(req.headers["content-type"] || "").split(";")[0].toLowerCase();
  if (!rules.mime.has(mime)) return res.status(415).json({ error: `Unsupported ${req.query.kind} file type` });
  const length = Number(req.headers["content-length"] || 0);
  if (length && length > rules.maxBytes) return res.status(413).json({ error: `File exceeds the ${rules.maxBytes / 1024 / 1024} MB limit` });
  try {
    const url = await uploadRequestStream(req, { ...rules, mime });
    return res.status(201).json({ url });
  } catch (error) {
    const status = error.code === "FILE_TOO_LARGE" ? 413 : error.code === "INVALID_FILE_SIGNATURE" ? 415 : 500;
    return res.status(status).json({ error: error.message || "Media upload failed" });
  }
});

module.exports = router;
