const cache = new Map();

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

async function resolveNearbyPlace({ query, latitude, longitude }) {
  const cacheKey = `${query.trim().toLowerCase()}|${latitude.toFixed(4)}|${longitude.toFixed(4)}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const longitudeSpan = 0.12;
  const latitudeSpan = 0.09;
  const searchUrl = new URL("https://nominatim.openstreetmap.org/search");
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
  if (cache.size >= 500) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, result);
  return result;
}

module.exports = { resolveNearbyPlace, distanceMeters };
