const crypto = require("crypto");

function getKey() {
  const configured = process.env.CHANNEL_PARTNER_ENCRYPTION_KEY;
  if (configured) return crypto.createHash("sha256").update(configured).digest();

  // Keep local development usable without persisting a known/default key.
  // Production must always use a dedicated, stable encryption secret.
  if (process.env.NODE_ENV !== "production" && process.env.JWT_SECRET) {
    return crypto.createHash("sha256").update(`channel-partner:${process.env.JWT_SECRET}`).digest();
  }

  if (process.env.NODE_ENV !== "test") {
    const error = new Error("Channel partner encryption is not configured");
    error.code = "ENCRYPTION_NOT_CONFIGURED";
    throw error;
  }
  return crypto.createHash("sha256").update("cleartitle-test-only-key").digest();
}

function encryptSensitive(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptSensitive(payload) {
  const [version, iv, tag, encrypted] = String(payload || "").split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid encrypted value");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

function hashLookup(value, purpose = "lookup") {
  const configured = process.env.CHANNEL_PARTNER_LOOKUP_KEY || process.env.CHANNEL_PARTNER_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!configured && process.env.NODE_ENV !== "test") {
    const error = new Error("Channel partner lookup key is not configured");
    error.code = "ENCRYPTION_NOT_CONFIGURED";
    throw error;
  }
  return crypto.createHmac("sha256", configured || "cleartitle-test-only-lookup-key").update(`${purpose}:${String(value)}`).digest("hex");
}

module.exports = { encryptSensitive, decryptSensitive, hashLookup };
