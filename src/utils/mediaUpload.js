const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const isBase64DataUri = (value) => typeof value === "string" && value.startsWith("data:");

function cloudinaryAssetFromUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.hostname !== "res.cloudinary.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const uploadIndex = parts.indexOf("upload");
    if (uploadIndex < 2 || parts[0] !== process.env.CLOUDINARY_CLOUD_NAME) return null;
    const resourceType = parts[1];
    if (!["image", "raw", "video"].includes(resourceType)) return null;
    const assetParts = parts.slice(uploadIndex + 1);
    if (/^v\d+$/.test(assetParts[0] || "")) assetParts.shift();
    let publicId = decodeURIComponent(assetParts.join("/"));
    if (resourceType !== "raw") publicId = publicId.replace(/\.[a-z0-9]+$/i, "");
    if (!publicId.startsWith("clear-title/properties/")) return null;
    return { url: value.trim(), publicId, resourceType };
  } catch {
    return null;
  }
}

function collectPropertyMediaAssets(value, assets = new Map()) {
  if (typeof value === "string") {
    const asset = cloudinaryAssetFromUrl(value);
    if (asset) assets.set(`${asset.resourceType}:${asset.publicId}`, asset);
    return [...assets.values()];
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectPropertyMediaAssets(item, assets));
    return [...assets.values()];
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectPropertyMediaAssets(item, assets));
  }
  return [...assets.values()];
}

async function deleteCloudinaryAssets(assets) {
  const groups = new Map();
  for (const candidate of assets || []) {
    const asset = candidate.publicId ? candidate : cloudinaryAssetFromUrl(candidate.url || candidate);
    if (!asset) continue;
    const key = asset.resourceType;
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(asset.publicId);
  }
  for (const [resourceType, ids] of groups) {
    const list = [...ids];
    for (let index = 0; index < list.length; index += 100) {
      await cloudinary.api.delete_resources(list.slice(index, index + 100), {
        resource_type: resourceType,
        type: "upload",
        invalidate: true,
      });
    }
  }
}

async function uploadIfBase64(value, { resourceType = "image", folder } = {}) {
  if (!isBase64DataUri(value)) return value;
  const result = await cloudinary.uploader.upload(value, { resource_type: resourceType, folder });
  return result.secure_url;
}

async function uploadArrayIfBase64(values, opts = {}) {
  if (!Array.isArray(values)) return values;
  return Promise.all(values.map((value) => uploadIfBase64(value, opts)));
}

function hasValidSignature(buffer, mime) {
  if (mime === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/webp") return buffer.length >= 12 && buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  if (mime === "application/pdf") return buffer.length >= 5 && buffer.subarray(0, 5).toString() === "%PDF-";
  if (mime === "video/mp4") return buffer.length >= 12 && buffer.subarray(4, 8).toString() === "ftyp";
  return false;
}

function uploadRequestStream(request, { resourceType, folder, maxBytes, mime }) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let prefix = Buffer.alloc(0);
    let settled = false;
    let cloudStream;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      if (cloudStream && !cloudStream.destroyed) cloudStream.destroy(error);
      reject(error);
    };

    cloudStream = cloudinary.uploader.upload_stream(
      { resource_type: resourceType, folder },
      (error, result) => {
        if (error) return fail(error);
        if (settled) return;
        settled = true;
        resolve(result.secure_url);
      }
    );
    cloudStream.on("error", (error) => {
      if (!settled) fail(error);
    });

    request.on("data", (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        const error = new Error(`File exceeds the ${maxBytes / 1024 / 1024} MB limit`);
        error.code = "FILE_TOO_LARGE";
        request.resume();
        fail(error);
        return;
      }
      if (prefix.length < 16) prefix = Buffer.concat([prefix, chunk]).subarray(0, 16);
      if (!cloudStream.write(chunk)) {
        request.pause();
        cloudStream.once("drain", () => request.resume());
      }
    });
    request.on("end", () => {
      if (settled) return;
      if (!hasValidSignature(prefix, mime)) {
        const error = new Error("File content does not match its declared type");
        error.code = "INVALID_FILE_SIGNATURE";
        fail(error);
        return;
      }
      cloudStream.end();
    });
    request.on("aborted", () => fail(new Error("Upload was interrupted")));
    request.on("error", fail);
  });
}

module.exports = {
  uploadIfBase64,
  uploadArrayIfBase64,
  uploadRequestStream,
  hasValidSignature,
  cloudinaryAssetFromUrl,
  collectPropertyMediaAssets,
  deleteCloudinaryAssets,
};
