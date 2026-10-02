const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");

const router = express.Router();
const MAX_BYTES = 200 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime"]);
const EXTENSION_MIME_TYPES = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  mp4: "video/mp4", m4v: "video/x-m4v", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo",
};
const root = path.resolve(process.env.CP_CAMPAIGN_MEDIA_DIR || path.join(process.cwd(), "storage", "cp-campaign-media"));
const metadataPath = (id) => path.join(root, `${id}.json`);
const filePath = (id) => path.join(root, id);

function safeName(value) {
  const decoded = (() => { try { return decodeURIComponent(String(value || "")); } catch { return String(value || ""); } })();
  const name = path.basename(decoded).replace(/[^a-zA-Z0-9._ -]/g, "_").trim();
  return (name || "campaign-file").slice(0, 180);
}

router.post("/", auth, adminOnly, async (req, res) => {
  const declaredMimeType = String(req.headers["content-type"] || "application/octet-stream").split(";")[0].toLowerCase();
  const originalName = safeName(req.headers["x-file-name"]);
  const extension = originalName.split(".").pop().toLowerCase();
  const mimeType = ALLOWED_MIME_TYPES.has(declaredMimeType) ? declaredMimeType : (EXTENSION_MIME_TYPES[extension] || declaredMimeType);
  const size = Number(req.headers["content-length"] || 0);
  if (!ALLOWED_MIME_TYPES.has(mimeType) && !["video/x-m4v", "video/x-matroska", "video/x-msvideo"].includes(mimeType)) return res.status(415).json({ error: "Supported files are PDF, JPG, PNG, WebP, MP4, WebM, MOV, M4V, MKV, and AVI." });
  if (!size) return res.status(411).json({ error: "File size is required." });
  if (size > MAX_BYTES) return res.status(413).json({ error: "File exceeds the 200 MB limit." });
  await fs.promises.mkdir(root, { recursive: true });
  const id = crypto.randomUUID();
  const temp = `${filePath(id)}.uploading`;
  const output = fs.createWriteStream(temp, { flags: "wx" });
  let bytes = 0;
  let hash = crypto.createHash("sha256");
  let settled = false;
  const fail = async (error, status = 500) => {
    if (settled) return;
    settled = true;
    req.resume();
    output.destroy();
    await fs.promises.rm(temp, { force: true }).catch(() => {});
    return res.status(status).json({ error: error.message || "Campaign file upload failed." });
  };
  req.on("data", (chunk) => {
    if (settled) return;
    bytes += chunk.length;
    if (bytes > MAX_BYTES) { void fail(new Error("File exceeds the 200 MB limit."), 413); return; }
    hash.update(chunk);
    if (!output.write(chunk)) req.pause();
  });
  output.on("drain", () => req.resume());
  req.on("aborted", () => { void fail(new Error("Upload was interrupted."), 400); });
  req.on("error", (error) => { void fail(error); });
  output.on("error", (error) => { void fail(error); });
  req.on("end", async () => {
    if (settled) return;
    if (bytes !== size) return void fail(new Error("Upload size did not match the declared file size."), 400);
    output.end(async () => {
      if (settled) return;
      const metadata = { id, originalName, mimeType, bytes, sha256: hash.digest("hex"), createdAt: new Date().toISOString() };
      try {
        await fs.promises.writeFile(metadataPath(id), JSON.stringify(metadata, null, 2), { flag: "wx" });
        await fs.promises.rename(temp, filePath(id));
        settled = true;
        return res.status(201).json({ ...metadata, title: metadata.originalName, storage: "local", url: `/api/cp-campaign-media/${id}` });
      } catch (error) { return void fail(error); }
    });
  });
});

router.get("/:id", auth, adminOnly, async (req, res) => {
  if (!/^[a-f0-9-]{20,50}$/i.test(req.params.id)) return res.status(400).json({ error: "Invalid campaign file." });
  try {
    const metadata = JSON.parse(await fs.promises.readFile(metadataPath(req.params.id), "utf8"));
    await fs.promises.access(filePath(req.params.id), fs.constants.R_OK);
    res.setHeader("Content-Type", metadata.mimeType || "application/octet-stream");
    res.setHeader("Content-Length", String(metadata.bytes));
    res.setHeader("Content-Disposition", `attachment; filename="${metadata.originalName.replace(/"/g, "")}"`);
    return fs.createReadStream(filePath(req.params.id)).pipe(res);
  } catch { return res.status(404).json({ error: "Campaign file not found on this server." }); }
});

module.exports = router;
