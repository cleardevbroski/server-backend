const express = require("express");
const rateLimit = require("express-rate-limit");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const { uploadRequestStream } = require("../utils/mediaUpload");

const router = express.Router();
const MAX_BYTES = 200 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "video/mp4", "video/webm", "video/quicktime"]);

router.post("/", rateLimit({ windowMs: 15 * 60 * 1000, max: 60 }), auth, adminOnly, async (req, res) => {
  const mime = String(req.headers["content-type"] || "").split(";")[0].toLowerCase();
  const length = Number(req.headers["content-length"] || 0);
  if (!ALLOWED.has(mime)) return res.status(415).json({ error: "Upload a JPG, PNG, WebP, MP4, WebM, MOV, or PDF file." });
  if (!length) return res.status(411).json({ error: "File size is required." });
  if (length > MAX_BYTES) return res.status(413).json({ error: "File exceeds the 200 MB limit." });
  try {
    const url = await uploadRequestStream(req, {
      mime,
      maxBytes: MAX_BYTES,
      resourceType: mime === "application/pdf" ? "raw" : mime.startsWith("video/") ? "video" : "image",
      folder: "clear-title/cp-crm/materials",
    });
    const rawName = String(req.headers["x-file-name"] || "Project material").slice(0, 180);
    let originalName = rawName;
    try { originalName = decodeURIComponent(rawName); } catch { /* Keep the safe header value. */ }
    return res.status(201).json({ url, title: originalName, mimeType: mime, bytes: length });
  } catch (error) {
    const status = error.code === "FILE_TOO_LARGE" ? 413 : error.code === "INVALID_FILE_SIGNATURE" ? 415 : 500;
    return res.status(status).json({ error: error.message || "Project material upload failed." });
  }
});

module.exports = router;
