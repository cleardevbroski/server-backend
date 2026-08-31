const cache = new Map();
const GeocodeCache = require("../models/GeocodeCache");

const CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

let lastRequestAt = 0;
let requestQueue = Promise.resolve();

function distanceMeters(latitude1, longitude1, latitude2, longitude2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const earthRadius = 6371000;
  const latitudeDelta = radians(latitude2 - latitude1);
  const longitudeDelta = radians(longitude2 - longitude1);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitude1)) * Math.cos(radians(latitude2)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function queuedFetch(url, options) {
  const task = requestQueue.then(async () => {
    const remainingDelay = Math.max(0, 1100 - (Date.now() - lastRequestAt));
    if (remainingDelay) await wait(remainingDelay);
    lastRequestAt = Date.now();
    return fetch(url, options);
  });
  requestQueue = task.catch(() => undefined);
  return task;
}

function serviceUrl(pathname) {
  const base = String(process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, "");
  return new URL(`${base}${pathname}`);
}

async function cachedResult(key) {
  if (cache.has(key)) return cache.get(key);
  try {
    const stored = await GeocodeCache.findOne({ key, expiresAt: { $gt: new Date() } }).lean();
    if (stored?.result) {
      cache.set(key, stored.result);
      return stored.result;
    }
  } catch (error) {
    console.warn("Geocode cache read failed:", error.message);
  }
  return undefined;
}

async function rememberResult(key, kind, result) {
  if (cache.size >= 500) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  try {
    await GeocodeCache.findOneAndUpdate(
      { key },
      { $set: { kind, result, expiresAt: new Date(Date.now() + CACHE_TTL_MS) } },
      { upsert: true },
    );
  } catch (error) {
    console.warn("Geocode cache write failed:", error.message);
  }
  return result;
}

async function resolveNearbyPlace({ query, latitude, longitude }) {
  const cacheKey = `${query.trim().toLowerCase()}|${latitude.toFixed(4)}|${longitude.toFixed(4)}`;
  const cached = await cachedResult(cacheKey);
  if (cached) return cached;

  const longitudeSpan = 0.12;
  const latitudeSpan = 0.09;
  const searchUrl = serviceUrl("/search");
  searchUrl.searchParams.set("q", query);
  searchUrl.searchParams.set("format", "jsonv2");
  searchUrl.searchParams.set("addressdetails", "1");
  searchUrl.searchParams.set("limit", "5");
  searchUrl.searchParams.set("bounded", "0");
  searchUrl.searchParams.set("viewbox", `${longitude - longitudeSpan},${latitude + latitudeSpan},${longitude + longitudeSpan},${latitude - latitudeSpan}`);

  const response = await queuedFetch(searchUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ClearTitleOne/1.0 (property-location-resolver)",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`OpenStreetMap geocoding returned ${response.status}`);
  const candidates = await response.json();
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({
      candidate,
      latitude: Number(candidate.lat),
      longitude: Number(candidate.lon),
    }))
    .filter(({ latitude: candidateLatitude, longitude: candidateLongitude }) => Number.isFinite(candidateLatitude) && Number.isFinite(candidateLongitude))
    .map((entry) => ({
      ...entry,
      approximateDistanceMeters: Math.round(distanceMeters(latitude, longitude, entry.latitude, entry.longitude)),
    }))
    .sort((left, right) => left.approximateDistanceMeters - right.approximateDistanceMeters);

  if (!ranked.length) return null;
  const best = ranked[0];
  const result = {
    latitude: best.latitude,
    longitude: best.longitude,
    osmId: `${best.candidate.osm_type || "place"}/${best.candidate.osm_id || ""}`,
    resolvedAddress: String(best.candidate.display_name || "").trim(),
    approximateDistanceMeters: best.approximateDistanceMeters,
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${best.latitude},${best.longitude}`,
  };
  return rememberResult(cacheKey, "nearby-search", result);
}

async function reverseProjectLocation({ latitude, longitude }) {
  const cacheKey = `project-reverse|${latitude.toFixed(6)}|${longitude.toFixed(6)}`;
  const cached = await cachedResult(cacheKey);
  if (cached) return cached;

  const reverseUrl = serviceUrl("/reverse");
  reverseUrl.searchParams.set("lat", latitude);
  reverseUrl.searchParams.set("lon", longitude);
  reverseUrl.searchParams.set("format", "jsonv2");
  reverseUrl.searchParams.set("addressdetails", "1");
  reverseUrl.searchParams.set("zoom", "18");
  reverseUrl.searchParams.set("layer", "address");
  reverseUrl.searchParams.set("entrances", "1");

  const response = await queuedFetch(reverseUrl, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent": "ClearTitleOne/1.0 (project-location-verification)",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`OpenStreetMap reverse geocoding returned ${response.status}`);
  }
  const candidate = await response.json();
  if (!candidate || candidate.error) return null;
  const address = candidate.address || {};
  const result = {
    inputLatitude: latitude,
    inputLongitude: longitude,
    resolvedLatitude: Number(candidate.lat),
    resolvedLongitude: Number(candidate.lon),
    resolvedAddress: String(candidate.display_name || "").trim(),
    components: {
      road: String(address.road || address.pedestrian || address.residential || "").trim(),
      neighbourhood: String(address.neighbourhood || address.quarter || "").trim(),
      suburb: String(address.suburb || address.city_district || "").trim(),
      city: String(address.city || address.town || address.village || address.municipality || "").trim(),
      district: String(address.state_district || address.county || "").trim(),
      state: String(address.state || "").trim(),
      pinCode: String(address.postcode || "").trim(),
      country: String(address.country || "").trim(),
    },
    osmId: `${candidate.osm_type || "place"}/${candidate.osm_id || ""}`,
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
    provider: "nominatim",
  };
  return rememberResult(cacheKey, "project-reverse", result);
}

module.exports = { resolveNearbyPlace, reverseProjectLocation, distanceMeters };
