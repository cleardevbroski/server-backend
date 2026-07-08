const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const isBase64DataUri = (value) => typeof value === "string" && value.startsWith("data:");

async function uploadIfBase64(value, { resourceType = "image", folder } = {}) {
  if (!isBase64DataUri(value)) return value;
  const result = await cloudinary.uploader.upload(value, { resource_type: resourceType, folder });
  return result.secure_url;
}

async function uploadArrayIfBase64(values, opts = {}) {
  if (!Array.isArray(values)) return values;
  return Promise.all(values.map((value) => uploadIfBase64(value, opts)));
}

module.exports = { uploadIfBase64, uploadArrayIfBase64 };
