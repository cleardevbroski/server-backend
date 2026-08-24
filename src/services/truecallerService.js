const axios = require("axios");

function isAllowedProfileEndpoint(rawEndpoint) {
  try {
    const endpoint = new URL(rawEndpoint);
    return endpoint.protocol === "https:" && endpoint.hostname.endsWith(".truecaller.com");
  } catch {
    return false;
  }
}

function normalizeIndianPhone(profile) {
  const raw = Array.isArray(profile?.phoneNumbers) ? profile.phoneNumbers[0] : "";
  const digits = String(raw || "").replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : "";
}

function normalizeProfile(profile) {
  const firstName = String(profile?.name?.first || "").trim();
  const lastName = String(profile?.name?.last || "").trim();
  const name = `${firstName} ${lastName}`.trim().slice(0, 100);
  const emailCandidate = String(profile?.onlineIdentities?.email || "").trim().toLowerCase();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailCandidate) ? emailCandidate : "";
  return { phone: normalizeIndianPhone(profile), name, email };
}

async function fetchTruecallerProfile(endpoint, accessToken) {
  if (!isAllowedProfileEndpoint(endpoint)) {
    throw new Error("Truecaller returned an invalid profile endpoint");
  }
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("Truecaller access token is missing");
  }

  const response = await axios.get(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Cache-Control": "no-cache",
    },
    timeout: 2200,
    maxRedirects: 0,
  });
  const profile = normalizeProfile(response.data);
  if (!profile.phone) throw new Error("Truecaller did not return a valid Indian mobile number");
  return profile;
}

module.exports = {
  fetchTruecallerProfile,
  isAllowedProfileEndpoint,
  normalizeProfile,
};
