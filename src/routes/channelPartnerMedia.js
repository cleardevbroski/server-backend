const express = require("express");
const { uploadRequestStream } = require("../utils/mediaUpload");

const router = express.Router();
const MAX_BYTES = 10 * 1024 * 1024;
const KINDS = new Set(["pan-card", "rera-certificate", "gst-certificate", "cancelled-cheque", "visiting-card", "company-logo", "signature"]);
const IMAGE_ONLY = new Set(["company-logo", "signature"]);

router.post("/", async (req, res) => {
  const kind = String(req.query.kind || "");
  if (!KINDS.has(kind)) return res.status(400).json({ error: "Invalid channel partner document kind" });
  const mime = String(req.headers["content-type"] || "").split(";")[0].toLowerCase();
  const allowed = IMAGE_ONLY.has(kind) ? ["image/jpeg", "image/png"] : ["image/jpeg", "image/png", "application/pdf"];
  if (!allowed.includes(mime)) return res.status(415).json({ error: "Only JPG, PNG, and applicable PDF files are supported" });
  const length = Number(req.headers["content-length"] || 0);
  if (!length) return res.status(411).json({ error: "File size is required" });
  if (length > MAX_BYTES) return res.status(413).json({ error: "File exceeds the 10 MB limit" });
  try {
    const url = await uploadRequestStream(req, {
      mime,
      maxBytes: MAX_BYTES,
      resourceType: mime === "application/pdf" ? "raw" : "image",
      folder: `clear-title/channel-partners/${kind}`,
    });
    return res.status(201).json({ url, mimeType: mime, bytes: length });
  } catch (error) {
    const status = error.code === "FILE_TOO_LARGE" ? 413 : error.code === "INVALID_FILE_SIGNATURE" ? 415 : 500;
    return res.status(status).json({ error: error.message || "Document upload failed" });
  }
});

module.exports = router;
