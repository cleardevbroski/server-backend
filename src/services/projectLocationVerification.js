const { reverseProjectLocation } = require("./nominatimService");

class ProjectLocationVerificationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ProjectLocationVerificationError";
    this.status = status;
  }
}

function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function coordinatePair(text) {
  const match = String(text || "").match(/(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  return validCoordinates(latitude, longitude) ? { latitude, longitude } : null;
}

function parseGeocodeInput({ geocode, latitude, longitude }) {
  const input = String(geocode || "").trim();
  let pair = input ? coordinatePair(input) : null;
  if (input && !pair) {
    try {
      const url = new URL(input);
      const queryValue = url.searchParams.get("query") || url.searchParams.get("q") || url.searchParams.get("ll");
      pair = coordinatePair(queryValue) || coordinatePair(url.pathname) || coordinatePair(url.hash);
      if (!pair) {
        const lat = Number(url.searchParams.get("lat"));
        const lon = Number(url.searchParams.get("lon") || url.searchParams.get("lng"));
        if (validCoordinates(lat, lon)) pair = { latitude: lat, longitude: lon };
      }
    } catch (_) {
      // The input may be a plain coordinate pair rather than a URL.
    }
  }
  if (pair) return { ...pair, coordinateSource: /^https?:\/\//i.test(input) ? "map_url" : "manual" };
  const numericLatitude = Number(latitude);
  const numericLongitude = Number(longitude);
  if (validCoordinates(numericLatitude, numericLongitude)) {
    return { latitude: numericLatitude, longitude: numericLongitude, coordinateSource: "manual" };
  }
  throw new ProjectLocationVerificationError(input
    ? "Could not find valid latitude and longitude in this geocode value."
    : "Enter the project latitude and longitude or paste a map URL.");
}

function normalizedWords(value) {
  const aliases = { bangalore: "bengaluru", bengaluru: "bengaluru" };
  return new Set(String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .map((word) => aliases[word] || word));
}

function wordOverlap(expected, actual) {
  const left = normalizedWords(expected);
  const right = normalizedWords(actual);
  if (!left.size || !right.size) return null;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

function compareProjectAddress(resolved, locality = {}, reraAddresses = []) {
  const checks = [];
  const addCheck = (key, label, expected, actual, passed, strong, weight) => {
    if (!String(expected || "").trim()) return;
    checks.push({ key, label, expected: String(expected).trim(), actual: String(actual || "").trim(), passed, strong, weight });
  };

  const components = resolved.components || {};
  const resolvedText = [resolved.resolvedAddress, ...Object.values(components)].filter(Boolean).join(" ");
  const cityActual = [components.city, components.district, resolved.resolvedAddress].filter(Boolean).join(" ");
  const cityOverlap = wordOverlap(locality.city, cityActual);
  addCheck("city", "City", locality.city, components.city || components.district, cityOverlap === null ? false : cityOverlap >= 1, true, 35);

  const expectedPin = String(locality.pinCode || "").replace(/\D/g, "");
  const actualPin = String(components.pinCode || "").replace(/\D/g, "");
  addCheck("pinCode", "PIN code", expectedPin, actualPin, Boolean(actualPin && expectedPin === actualPin), true, 35);

  const enteredAddress = [locality.address, locality.landmark].filter(Boolean).join(" ");
  const addressOverlap = wordOverlap(enteredAddress, resolvedText);
  addCheck("address", "Entered address", enteredAddress, resolved.resolvedAddress, addressOverlap === null ? false : addressOverlap >= 0.35, false, 15);

  const reraAddress = reraAddresses.find((value) => String(value || "").trim());
  const reraOverlap = wordOverlap(reraAddress, resolvedText);
  addCheck("reraAddress", "RERA registered address", reraAddress, resolved.resolvedAddress, reraOverlap === null ? false : reraOverlap >= 0.3, false, 15);

  const totalWeight = checks.reduce((total, check) => total + check.weight, 0);
  const passedWeight = checks.filter((check) => check.passed).reduce((total, check) => total + check.weight, 0);
  const mismatchFields = checks.filter((check) => check.strong && !check.passed).map((check) => check.label);
  const warnings = checks.filter((check) => !check.strong && !check.passed)
    .map((check) => `${check.label} does not closely match the resolved map address.`);
  if (!checks.length) warnings.push("No entered address, city, PIN code or RERA address was available for comparison.");
  return {
    matchScore: totalWeight ? Math.round((passedWeight / totalWeight) * 100) : 0,
    matches: Object.fromEntries(checks.map((check) => [check.key, check.passed])),
    comparisons: checks,
    mismatchFields,
    warnings,
  };
}

async function analyzeProjectLocation(input) {
  const coordinates = parseGeocodeInput(input);
  const resolved = await reverseProjectLocation(coordinates);
  if (!resolved) throw new ProjectLocationVerificationError("No mapped address was found for these coordinates.", 404);
  const comparison = compareProjectAddress(resolved, input.locality, input.reraAddresses);
  return {
    status: comparison.mismatchFields.length ? "mismatch" : "resolved",
    coordinateSource: coordinates.coordinateSource,
    ...resolved,
    matchScore: comparison.matchScore,
    matches: comparison.matches,
    comparisons: comparison.comparisons,
    mismatchFields: comparison.mismatchFields,
    warnings: comparison.warnings,
    analyzedAt: new Date().toISOString(),
  };
}

function confirmProjectLocation(analysis, admin) {
  if (!analysis || !validCoordinates(Number(analysis.inputLatitude), Number(analysis.inputLongitude)) || !analysis.resolvedAddress || !analysis.analyzedAt || analysis.provider !== "nominatim") {
    throw new ProjectLocationVerificationError("Analyze the project location before confirming it.");
  }
  if (analysis.status === "mismatch" || (analysis.mismatchFields || []).length) {
    throw new ProjectLocationVerificationError("Resolve the city or PIN code mismatch before confirming this location.", 409);
  }
  return {
    ...analysis,
    status: "admin_verified",
    verifiedBy: admin?._id || admin,
    verifiedAt: new Date().toISOString(),
  };
}

module.exports = {
  ProjectLocationVerificationError,
  parseGeocodeInput,
  compareProjectAddress,
  analyzeProjectLocation,
  confirmProjectLocation,
};
