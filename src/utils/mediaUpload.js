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

function hasValidSignature(buffer, mime) {
  if (mime === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/webp") return buffer.length >= 12 && buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  if (mime === "application/pdf") return buffer.length >= 5 && buffer.subarray(0, 5).toString() === "%PDF-";
  if (mime === "video/webm") return buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
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

module.exports = { uploadIfBase64, uploadArrayIfBase64, uploadRequestStream, hasValidSignature };
