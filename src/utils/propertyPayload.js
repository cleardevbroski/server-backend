const {
  PROPERTY_DOCUMENT_MAX_BYTES,
  PROPERTY_DOCUMENT_MAX_MB,
  PROPERTY_WALKTHROUGH_MAX_BYTES,
  PROPERTY_WALKTHROUGH_MAX_MB,
} = require("./propertyMediaLimits");

const FACING_OPTIONS = new Set([
  "East",
  "West",
  "North",
  "South",
  "North-East",
  "North-West",
  "South-East",
  "South-West",
]);
const FACING_ERROR_MESSAGE = "Plot facing must be one direction: East, West, North, South, North-East, North-West, South-East, or South-West";
const VILLA_TYPES = new Set(["Independent", "Row Villa", "Twin Villa", "Villament", "Penthouse", "Duplex Villa", "Triplex Villa", "Luxury Villa", "Mansion", "Mixed Villa Development"]);
const VILLA_UNIT_VARIANTS = new Set(["Simplex", "Duplex", "Triplex", "Villament", "Penthouse", "Row House", "Independent Villa", "Twin Villa", "Sky Villa", "Luxury Villa", "Mansion", "Custom"]);
const VILLA_POSSESSION_STATUSES = new Set(["Ready to Move", "Under Construction"]);
const FURNISHING_OPTIONS = new Set(["Unfurnished", "Semi-Furnished", "Fully Furnished"]);
const PLOT_APPROVAL_AUTHORITIES = new Set(["BMRDA", "BDA", "BBMP", "DTCP", "Panchayat", "MPA"]);
const PLOT_LAYOUT_STATUSES = new Set(["Layout Ready", "Under Development"]);
const PLOT_INVENTORY_STATUSES = new Set(["Available", "Booked", "Sold"]);
const COMMERCIAL_SUBTYPES = new Set(["Office Space", "Shop/Showroom", "Warehouse", "Industrial Shed", "Co-working"]);
const COMMERCIAL_ZONES = new Set(["IT/ITES SEZ", "Non-SEZ", "Retail", "Industrial"]);
const COMMERCIAL_GRADES = new Set(["Grade A", "Grade B", "Grade C", "Not Applicable"]);
const COMMERCIAL_PANTRIES = new Set(["None", "Shared Pantry", "Private Pantry"]);
const COMMERCIAL_FURNISHING = new Set(["Bare Shell", "Warm Shell", "Fully Furnished"]);
const PG_SHARING_TYPES = new Set(["Single occupancy", "Double sharing", "Triple sharing", "Four sharing"]);
const ROOM_CATEGORIES = new Set(["bedroom", "bathroom", "kitchen", "living", "dining", "balcony", "utility", "other"]);
const FACILITY_STATUSES = new Set(["Available", "Planned", "Under Construction"]);
const RERA_DOCUMENTS = new Map([
  ["registration-certificate", ["Registration Certificate", "Annexure 1"]],
  ["certificate-of-incorporation", ["Certificate of Incorporation", ""]],
  ["memorandum-of-association", ["Memorandum of Association", "Annexure 15"]],
  ["articles-of-association", ["Articles of Association", "Annexure 16"]],
  ["pan-card", ["PAN Card", "Annexure 2"]],
]);
const KARNATAKA_RERA_URL = "https://rera.karnataka.gov.in/viewAllProjects";
const KARNATAKA_RERA_HOSTS = new Set(["rera.karnataka.gov.in", "www.rera.karnataka.gov.in"]);
const PROJECT_DOCUMENTS = new Map([
  ["commencement-certificate", ["Commencement Certificate", "Annexure 80"]],
  ["approved-building-plan", ["Approved Building Plan", "Annexure 81"]],
  ["sectional-drawing", ["Sectional Drawing of the Apartments", "Annexure 82"]],
  ["structural-safety-certificate", ["Structural Safety Certificate from Registered Engineer", "Annexure 83"]],
  ["project-specifications", ["Project Specifications", "Annexure 84"]],
  ["brochure", ["Brochure", "Annexure 85"]],
  ["relinquishment-deed", ["Relinquishment Deed", "Annexure 86"]],
  ["agreement-for-sale", ["Proforma of Agreement for Sale", "Annexure 87"]],
  ["allotment-letter", ["Proforma of Allotment Letter", "Annexure 88"]],
]);

class PropertyPayloadError extends Error {
  constructor(message) {
    super(message);
    this.name = "PropertyPayloadError";
  }
}

function normalizeKarnatakaReraUrl(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return KARNATAKA_RERA_URL;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || !KARNATAKA_RERA_HOSTS.has(url.hostname.toLowerCase())) throw new Error("invalid host");
    return url.toString();
  } catch {
    throw new PropertyPayloadError("RERA website must be an HTTPS URL on rera.karnataka.gov.in");
  }
}

function normalizeConfiguration(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+)\s*bhk$/i);
  if (!match || Number(match[1]) < 1) {
    throw new PropertyPayloadError("Configurations must use a positive whole-number BHK label, for example 2 BHK");
  }
  return `${Number(match[1])} BHK`;
}

function inferVillaUnitVariant(value) {
  const normalized = String(value || "").toLowerCase();
  if (/\btriplex\b/.test(normalized)) return "Triplex";
  if (/\bduplex\b/.test(normalized)) return "Duplex";
  if (/\bsimplex\b/.test(normalized)) return "Simplex";
  if (/\bvillament\b/.test(normalized)) return "Villament";
  if (/\bpent\s*house\b/.test(normalized)) return "Penthouse";
  if (/\bsky\s*villa\b/.test(normalized)) return "Sky Villa";
  if (/\b(row\s*(?:house|villa)|town\s*house)\b/.test(normalized)) return "Row House";
  if (/\bmansion\b/.test(normalized)) return "Mansion";
  if (/\bluxury\s*villa\b/.test(normalized)) return "Luxury Villa";
  if (/\btwin\s*villa\b/.test(normalized)) return "Twin Villa";
  if (/\bindependent\s*villa\b/.test(normalized)) return "Independent Villa";
  if (/^villa$/.test(normalized.trim())) return "Independent Villa";
  return undefined;
}

function normalizeVillaBhk(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const match = normalized.match(/^(\d+(?:\.5)?)\s*bhk$/i);
  if (!match || Number(match[1]) < 1) throw new PropertyPayloadError("Villa BHK must use a positive label, for example 4 BHK");
  return `${Number(match[1])} BHK`;
}

function normalizeVillaConfiguration(value) {
  let configuration = String(value || "").trim().replace(/\s+/g, " ");
  if (!configuration || configuration.length > 120 || /[\r\n]/.test(configuration)) {
    throw new PropertyPayloadError("Villa configuration must be a label such as 4 BHK Duplex (G+1), Villament, or Penthouse");
  }
  const bhkMatch = configuration.match(/(\d+(?:\.5)?)\s*bhk\b/i);
  const inferredVariant = inferVillaUnitVariant(configuration);
  if (!bhkMatch && !inferredVariant) {
    throw new PropertyPayloadError("Villa configuration must include a BHK or a recognized Villa variant");
  }
  if (bhkMatch) configuration = configuration.replace(bhkMatch[0], `${Number(bhkMatch[1])} BHK`);
  return configuration
    .replace(/pent\s*house/gi, "Penthouse")
    .replace(/\(\s*(G\s*\+\s*\d+|\d+)\s*\)/gi, (_, structure) => `(${structure.replace(/\s+/g, "").toUpperCase()})`);
}

function requireText(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new PropertyPayloadError(`${label} is required`);
  return normalized;
}

function requireInteger(value, label, min) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) {
    throw new PropertyPayloadError(`${label} must be a whole number of at least ${min}`);
  }
  return number;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") throw new PropertyPayloadError(`${label} must be Yes or No`);
  return value;
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isCalendarMonth(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})$/);
  return Boolean(match && Number(match[2]) >= 1 && Number(match[2]) <= 12);
}

function isCompletionMonth(value) {
  // Accept legacy YYYY-MM-DD values during edits; new forms submit YYYY-MM.
  return isCalendarMonth(value) || isCalendarDate(value);
}

function parseNumericDisplay(value, field) {
  const match = String(value || "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!match) return Number.NaN;
  const number = Number(match[1]);
  if (field !== "price") return number;
  const unit = String(value || "").toLowerCase();
  if (/\b(cr|crore)\b/.test(unit)) return number * 10000000;
  if (/\b(l|lac|lakh)\b/.test(unit)) return number * 100000;
  return number;
}

function requirePositiveDisplay(value, label, field = "area") {
  const normalized = requireText(value, label);
  const number = parseNumericDisplay(normalized, field);
  if (!Number.isFinite(number) || number <= 0) {
    throw new PropertyPayloadError(`${label} must contain a positive number`);
  }
  return normalized;
}

function optionalPositiveDisplay(value, label, field = "area") {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const number = parseNumericDisplay(normalized, field);
  if (!Number.isFinite(number) || number <= 0) throw new PropertyPayloadError(`${label} must contain a positive number`);
  return normalized;
}

function optionalInteger(value, label, min) {
  if (value === undefined || value === null || value === "") return undefined;
  return requireInteger(value, label, min);
}

function optionalAssetUrl(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(normalized)) return normalized;
  try {
    const url = new URL(normalized);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return normalized;
  } catch {
    throw new PropertyPayloadError(`${label} must be a valid HTTP(S) image URL`);
  }
}

function optionalPositiveNumber(value, label) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new PropertyPayloadError(`${label} must be zero or greater`);
  return number;
}

function optionalCoordinate(value, label, minimum, maximum) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new PropertyPayloadError(`${label} must be between ${minimum} and ${maximum}`);
  }
  return number;
}

function optionalHttpUrl(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    return url.toString();
  } catch {
    throw new PropertyPayloadError(`${label} must be a valid HTTP(S) URL`);
  }
}

function normalizeRooms(rooms, configuration) {
  if (!Array.isArray(rooms) || rooms.length === 0) return undefined;
  return rooms.map((room, index) => {
    const name = requireText(room.name, `${configuration} room ${index + 1} name`);
    const category = ROOM_CATEGORIES.has(room.category) ? room.category : "other";
    const polygon = Array.isArray(room.polygon) && room.polygon.length >= 3
      ? room.polygon.map((point) => {
          const x = Number(point?.x);
          const y = Number(point?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) {
            throw new PropertyPayloadError(`${configuration} ${name} hotspot coordinates must be between 0 and 100`);
          }
          return { x, y };
        })
      : undefined;
    return {
      id: String(room.id || `${configuration}-${index + 1}`).trim(),
      name,
      category,
      length: optionalPositiveNumber(room.length, `${configuration} ${name} length`),
      width: optionalPositiveNumber(room.width, `${configuration} ${name} width`),
      area: optionalPositiveNumber(room.area, `${configuration} ${name} area`),
      unit: room.unit === "m" ? "m" : "ft",
      description: String(room.description || "").trim(),
      flooring: String(room.flooring || "").trim(),
      polygon,
    };
  });
}

function normalizeFacilities(facilities) {
  if (!Array.isArray(facilities) || facilities.length === 0) return undefined;
  return facilities.map((facility, index) => ({
    id: String(facility.id || `facility-${index + 1}`).trim(),
    name: requireText(facility.name, `Facility ${index + 1} name`),
    category: String(facility.category || "Other").trim(),
    description: String(facility.description || "").trim(),
    imageUrl: optionalAssetUrl(facility.imageUrl, `Facility ${index + 1} image`),
    status: FACILITY_STATUSES.has(facility.status) ? facility.status : "Available",
    hours: String(facility.hours || "").trim(),
  }));
}

function compactTextList(value, maxItems, label, maxLength = 2000) {
  if (!Array.isArray(value)) return undefined;
  const rows = value.map((item) => String(item || "").trim()).filter(Boolean);
  if (rows.length > maxItems) throw new PropertyPayloadError(`${label} supports up to ${maxItems} entries`);
  return rows.length ? [...new Set(rows.map((item) => item.slice(0, maxLength)))] : undefined;
}

function normalizeProjectContent(payload) {
  const narrative = payload.projectNarrative;
  if (narrative && typeof narrative === "object") {
    const keyDetails = Array.isArray(narrative.keyDetails)
      ? narrative.keyDetails.map((row) => ({
          label: String(row?.label || "").trim().slice(0, 120),
          value: String(row?.value || "").trim().slice(0, 500),
        })).filter((row) => row.label && row.value).slice(0, 30)
      : undefined;
    const featureGroups = Array.isArray(narrative.featureGroups)
      ? narrative.featureGroups.map((group) => ({
          title: String(group?.title || "").trim().slice(0, 160),
          items: compactTextList(group?.items, 30, "Feature group", 500) || [],
        })).filter((group) => group.title && group.items.length).slice(0, 12)
      : undefined;
    const normalized = {
      introduction: compactTextList(narrative.introduction, 12, "Introduction"),
      usps: compactTextList(narrative.usps, 20, "USP", 500),
      keyDetails: keyDetails?.length ? keyDetails : undefined,
      featureGroups: featureGroups?.length ? featureGroups : undefined,
      locationAdvantage: compactTextList(narrative.locationAdvantage, 10, "Location advantage"),
      investmentReasons: compactTextList(narrative.investmentReasons, 10, "Investment reason"),
    };
    payload.projectNarrative = Object.values(normalized).some(Boolean) ? normalized : undefined;
  } else {
    payload.projectNarrative = undefined;
  }

  const masterPlan = payload.masterPlan;
  if (masterPlan && typeof masterPlan === "object") {
    const imageUrl = optionalAssetUrl(masterPlan.imageUrl, "Master plan image");
    const sections = Array.isArray(masterPlan.sections)
      ? masterPlan.sections.map((section) => ({
          heading: String(section?.heading || "").trim().slice(0, 180),
          body: String(section?.body || "").trim().slice(0, 3000),
        })).filter((section) => section.heading && section.body).slice(0, 12)
      : undefined;
    const normalized = {
      imageUrl,
      title: String(masterPlan.title || "").trim().slice(0, 180),
      summary: String(masterPlan.summary || "").trim().slice(0, 5000),
      sections: sections?.length ? sections : undefined,
    };
    payload.masterPlan = Object.values(normalized).some(Boolean) ? normalized : undefined;
  } else {
    payload.masterPlan = undefined;
  }

  if (Array.isArray(payload.projectDownloads)) {
    const seen = new Set();
    payload.projectDownloads = payload.projectDownloads.map((document) => {
      const kind = String(document?.kind || "");
      if (!["brochure", "master-plan", "walkthrough"].includes(kind) || seen.has(kind)) {
        throw new PropertyPayloadError("Project download types must be valid and unique");
      }
      seen.add(kind);
      const fileUrl = String(document.fileUrl || "").trim();
      if (!isHttpUrl(fileUrl) || new URL(fileUrl).hostname !== "res.cloudinary.com") {
        throw new PropertyPayloadError("Project downloads must be uploaded through ClearTitle");
      }
      const mimeType = String(document.mimeType || "").toLowerCase();
      const expectedMime = kind === "walkthrough" ? "video/mp4" : "application/pdf";
      if (mimeType !== expectedMime) throw new PropertyPayloadError(`${kind} has an invalid file type`);
      const fileSize = Number(document.fileSize);
      const maxBytes = kind === "walkthrough" ? PROPERTY_WALKTHROUGH_MAX_BYTES : PROPERTY_DOCUMENT_MAX_BYTES;
      const maxMb = kind === "walkthrough" ? PROPERTY_WALKTHROUGH_MAX_MB : PROPERTY_DOCUMENT_MAX_MB;
      if (!Number.isFinite(fileSize) || fileSize < 1 || fileSize > maxBytes) {
        throw new PropertyPayloadError(`${document.label || kind} must be no larger than ${maxMb} MB`);
      }
      return {
        ...(document._id ? { _id: document._id } : {}),
        kind,
        label: requireText(document.label, "Project download label").slice(0, 120),
        fileName: requireText(document.fileName, "Project download filename").slice(0, 255),
        fileUrl,
        mimeType,
        fileSize,
      };
    });
  } else {
    payload.projectDownloads = [];
  }

  const walkthroughVideoUrl = String(payload.walkthroughVideoUrl || "").trim();
  if (walkthroughVideoUrl) {
    try {
      const url = new URL(walkthroughVideoUrl);
      const host = url.hostname.toLowerCase().replace(/^www\./, "");
      let videoId = "";
      if (host === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0] || "";
      if (["youtube.com", "m.youtube.com"].includes(host)) {
        videoId = url.searchParams.get("v") || "";
        if (!videoId) {
          const parts = url.pathname.split("/").filter(Boolean);
          if (["shorts", "embed", "live"].includes(parts[0])) videoId = parts[1] || "";
        }
      }
      if (url.protocol !== "https:" || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error();
      payload.walkthroughVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    } catch {
      throw new PropertyPayloadError("Walkthrough video must be a valid HTTPS YouTube link");
    }
  } else {
    payload.walkthroughVideoUrl = "";
  }

  if (Array.isArray(payload.faqs)) {
    if (payload.faqs.length > 15) throw new PropertyPayloadError("A property supports up to 15 FAQs");
    payload.faqs = payload.faqs.map((faq, index) => ({
      question: requireText(faq?.question, `FAQ ${index + 1} question`).slice(0, 500),
      answer: requireText(faq?.answer, `FAQ ${index + 1} answer`).slice(0, 3000),
      order: index,
    }));
  } else {
    payload.faqs = [];
  }
}

function validateLocalityAndNearby(payload) {
  if (payload.locality?.pinCode && !/^\d{6}$/.test(payload.locality.pinCode)) {
    throw new PropertyPayloadError("PIN code must contain exactly 6 digits");
  }
  if (payload.locality) {
    payload.locality.latitude = optionalCoordinate(payload.locality.latitude, "Property latitude", -90, 90);
    payload.locality.longitude = optionalCoordinate(payload.locality.longitude, "Property longitude", -180, 180);
    if ((payload.locality.latitude === undefined) !== (payload.locality.longitude === undefined)) {
      throw new PropertyPayloadError("Property latitude and longitude must be provided together");
    }
  }
  payload.facilities = normalizeFacilities(payload.facilities);
  payload.nearbyDetails = validateNearbyDetails(payload.nearbyDetails);
  normalizeProjectContent(payload);
}

function normalizeProjectAreaAndInventory(payload) {
  const projectArea = payload.projectArea;
  if (projectArea && Object.values(projectArea).some((value) => value !== undefined && value !== null && value !== "")) {
    const totalAcres = optionalPositiveNumber(projectArea.totalAcres, "Total land area");
    // Pending records created by the old form contain square-foot numbers in
    // fields incorrectly named *Acres. Treat those values as square feet 1:1.
    const openSpaceSqft = optionalPositiveNumber(projectArea.openSpaceSqft ?? projectArea.openSpaceAcres, "Open space area");
    const builtUpSqft = optionalPositiveNumber(projectArea.builtUpSqft ?? projectArea.builtUpAcres, "Project built-up area");
    const amenitiesSqft = optionalPositiveNumber(projectArea.amenitiesSqft ?? projectArea.amenitiesAcres, "Amenities area");
    payload.projectArea = { totalAcres, openSpaceSqft, builtUpSqft, amenitiesSqft };
  } else {
    payload.projectArea = undefined;
  }
  payload.totalUnits = payload.totalUnits === undefined || payload.totalUnits === null || payload.totalUnits === ""
    ? undefined
    : requireInteger(payload.totalUnits, "Total number of units", 1);
  payload.totalTowers = payload.totalTowers === undefined || payload.totalTowers === null || payload.totalTowers === ""
    ? undefined
    : requireInteger(payload.totalTowers, "Total number of towers", 1);
}

function validateSharedStructuredFields(payload, propertyLabel) {
  if (propertyLabel !== "PG / Co-living" && payload.transactionType !== "New Property") {
    throw new PropertyPayloadError(payload.transactionType === "Resale" ? "Resale properties are not applicable" : `${propertyLabel} transaction type must be New Property`);
  }
  if (payload.reraRegistered) {
    payload.reraPhases = normalizeReraPhases(payload.reraPhases, payload.reraNumber, propertyLabel);
    payload.reraNumber = payload.reraPhases[0].reraNumber;
  } else {
    payload.reraNumber = "";
    payload.reraPhases = [];
  }
  validateLocalityAndNearby(payload);
  normalizeProjectAreaAndInventory(payload);
}

function normalizeReraDocuments(documents, allowed, groupLabel) {
  if (!Array.isArray(documents)) return [];
  const seen = new Set();
  return documents.map((document, index) => {
    const key = String(document?.key || "").trim();
    if (!allowed.has(key) || seen.has(key)) {
      throw new PropertyPayloadError(`${groupLabel} document types must be valid and unique`);
    }
    seen.add(key);
    const [label, annexure] = allowed.get(key);
    const fileUrl = String(document.fileUrl || "").trim();
    if (!isHttpUrl(fileUrl) || new URL(fileUrl).hostname !== "res.cloudinary.com") {
      throw new PropertyPayloadError(`${label} requires a file uploaded through ClearTitle`);
    }
    const mimeType = String(document.mimeType || "").toLowerCase();
    if (!["application/pdf", "image/jpeg", "image/png"].includes(mimeType)) {
      throw new PropertyPayloadError(`${label} must be a PDF, JPG, or PNG document`);
    }
    const fileSize = Number(document.fileSize);
    if (!Number.isFinite(fileSize) || fileSize < 1 || fileSize > PROPERTY_DOCUMENT_MAX_BYTES) {
      throw new PropertyPayloadError(`${label} must be no larger than ${PROPERTY_DOCUMENT_MAX_MB} MB`);
    }
    return {
      ...(document._id ? { _id: document._id } : {}),
      key,
      label,
      annexure,
      fileName: requireText(document.fileName, `${label} filename`).slice(0, 255),
      fileUrl,
      mimeType,
      fileSize,
      uploadedAt: document.uploadedAt || new Date(),
      order: index,
    };
  });
}

function normalizeReraPhases(phases, legacyNumber, propertyLabel) {
  const source = Array.isArray(phases) && phases.length
    ? phases
    : legacyNumber
      ? [{ name: "Phase 1", reraNumber: legacyNumber, reraDocuments: [], projectDocuments: [] }]
      : [];
  if (!source.length) throw new PropertyPayloadError(`RERA number and at least one RERA phase are required for this ${propertyLabel}`);
  const seenNames = new Set();
  const seenNumbers = new Set();
  return source.map((phase, index) => {
    const name = requireText(phase?.name, `RERA phase ${index + 1} name`).slice(0, 100);
    const reraNumber = requireText(phase?.reraNumber, `${name} RERA number`);
    if (!/^[A-Za-z0-9/._-]{8,50}$/.test(reraNumber)) {
      throw new PropertyPayloadError(`${name} RERA number must be 8-50 characters using letters, numbers, /, ., _, or -`);
    }
    const nameKey = name.toLowerCase();
    const numberKey = reraNumber.toLowerCase();
    if (seenNames.has(nameKey) || seenNumbers.has(numberKey)) {
      throw new PropertyPayloadError("RERA phase names and registration numbers must be unique");
    }
    seenNames.add(nameKey);
    seenNumbers.add(numberKey);
    return {
      ...(phase._id ? { _id: phase._id } : {}),
      name,
      reraNumber,
      reraSiteUrl: normalizeKarnatakaReraUrl(phase.reraSiteUrl),
      order: index,
      reraDocuments: normalizeReraDocuments(phase.reraDocuments, RERA_DOCUMENTS, "RERA"),
      projectDocuments: normalizeReraDocuments(phase.projectDocuments, PROJECT_DOCUMENTS, "Project"),
    };
  });
}

function deriveRange(rows, field) {
  const values = rows
    .map((row) => ({ display: row[field], value: parseNumericDisplay(row[field], field) }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => a.value - b.value);
  if (!values.length) return "";
  return values[0].value === values[values.length - 1].value
    ? values[0].display
    : `${values[0].display} - ${values[values.length - 1].display}`;
}

function validateNearbyDetails(nearbyDetails) {
  if (!nearbyDetails || typeof nearbyDetails !== "object") return nearbyDetails;
  const result = {};
  for (const key of ["schools", "colleges", "hospitals", "shopping", "metro", "workplaces", "parks", "roads"]) {
    const item = nearbyDetails[key];
    if (!item) continue;
    const places = Array.isArray(item.places)
      ? item.places
          .filter((place) => place && Object.values(place).some((value) => String(value || "").trim()))
          .map((place, index) => ({
            name: requireText(place.name, `${key} place ${index + 1} name`),
            address: String(place.address || "").trim(),
            distance: String(place.distance || "").trim(),
            landmark: String(place.landmark || "").trim(),
            latitude: optionalCoordinate(place.latitude, `${key} place ${index + 1} latitude`, -90, 90),
            longitude: optionalCoordinate(place.longitude, `${key} place ${index + 1} longitude`, -180, 180),
            osmId: String(place.osmId || "").trim(),
            mapUrl: optionalHttpUrl(place.mapUrl, `${key} place ${index + 1} map URL`),
            resolvedAddress: String(place.resolvedAddress || "").trim(),
            approximateDistanceMeters: optionalPositiveNumber(place.approximateDistanceMeters, `${key} place ${index + 1} approximate distance`),
          }))
      : [];
    const hasLegacy = (item.count !== undefined && item.count !== null && item.count !== "") || String(item.distance || "").trim();
    if (!places.length && !hasLegacy) continue;
    for (const [index, place] of places.entries()) {
      if ((place.latitude === undefined) !== (place.longitude === undefined)) {
        throw new PropertyPayloadError(`${key} place ${index + 1} latitude and longitude must be provided together`);
      }
    }
    result[key] = places.length
      ? { places }
      : {
          count: requireInteger(item.count, `${key} count`, 0),
          distance: requireText(item.distance, `${key} distance`),
        };
  }
  return result;
}

function normalizeApartmentPayload(input, { requireStructured = false } = {}) {
  const payload = { ...input };
  const hasStructured = Array.isArray(payload.configurationDetails);
  if (!hasStructured && !requireStructured) return payload;
  if (!hasStructured || payload.configurationDetails.length === 0) {
    throw new PropertyPayloadError("At least one Apartment configuration is required");
  }

  const rows = payload.configurationDetails.map((row, index) => {
    const configuration = normalizeConfiguration(row.configuration);
    const facings = Array.isArray(row.facings) ? [...new Set(row.facings.map((v) => String(v).trim()).filter(Boolean))] : [];
    if (facings.some((facing) => !FACING_OPTIONS.has(facing))) {
      throw new PropertyPayloadError(`Configuration ${index + 1} contains invalid facing options`);
    }
    return {
      id: String(row.id || `${configuration}-${index + 1}`).trim(),
      configuration,
      price: requireText(row.price, `${configuration} price`),
      // Kept only for backwards compatibility with already-published records.
      superBuiltUpArea: String(row.superBuiltUpArea || "").trim(),
      carpetArea: requireText(row.carpetArea, `${configuration} carpet area`),
      builtUpArea: String(row.builtUpArea || "").trim(),
      bedrooms: requireInteger(row.bedrooms, `${configuration} bedrooms`, 1),
      bathrooms: requireInteger(row.bathrooms, `${configuration} bathrooms`, 1),
      balconies: requireInteger(row.balconies, `${configuration} balconies`, 0),
      facings,
      floorPlan2dUrl: optionalAssetUrl(row.floorPlan2dUrl, `${configuration} 2D floor plan`),
      floorPlan3dUrl: optionalAssetUrl(row.floorPlan3dUrl, `${configuration} 3D floor plan`),
      rooms: normalizeRooms(row.rooms, configuration),
    };
  });

  if (Array.isArray(payload.configs) && payload.configs.length) {
    const tags = payload.configs.map(normalizeConfiguration);
    if (tags.length !== rows.length || tags.some((tag, index) => tag !== rows[index].configuration)) {
      throw new PropertyPayloadError("Configuration tags and detail rows must match in the same order");
    }
  }

  const possession = payload.possessionDetails;
  if (!possession || !["Ready to Move", "Under Construction", "New Launch"].includes(possession.status)) {
    throw new PropertyPayloadError("A valid possession status is required");
  }
  const isUnderConstruction = possession.status === "Under Construction";
  if (isUnderConstruction) {
    if (!isCompletionMonth(possession.expectedCompletionDate) || possession.launchDate) {
      throw new PropertyPayloadError("Under Construction requires only an expected completion month and year");
    }
  } else if (!isCalendarDate(possession.launchDate) || possession.expectedCompletionDate) {
    throw new PropertyPayloadError(`${possession.status} requires only a launch date`);
  }

  validateSharedStructuredFields(payload, "Apartment");
  payload.ownershipType = undefined;
  payload.bookingAmount = undefined;
  if (String(payload.description || "").trim().length < 50) {
    throw new PropertyPayloadError("Apartment description must contain at least 50 characters");
  }
  // `floorLabel` was the deprecated Apartment “Flat Floor” input. Ignore it
  // for new payloads while retaining schema/read compatibility for old records.
  payload.floorLabel = undefined;
  payload.configurationDetails = rows;
  payload.villaDetails = undefined;
  payload.commercialDetails = undefined;
  payload.pgDetails = undefined;
  payload.configs = rows.map((row) => row.configuration);
  payload.possessionDetails = {
    status: possession.status,
    launchDate: isUnderConstruction ? "" : possession.launchDate,
    expectedCompletionDate: isUnderConstruction ? possession.expectedCompletionDate : "",
  };
  payload.possession = possession.status;
  payload.ageOfProperty = possession.status === "Under Construction" ? "Under Construction" : "";
  payload.price = deriveRange(rows, "price") || payload.price;
  payload.area = deriveRange(rows, "builtUpArea") || deriveRange(rows, "superBuiltUpArea") || deriveRange(rows, "carpetArea") || payload.area;
  payload.bedrooms = Math.min(...rows.map((row) => row.bedrooms));
  payload.bathrooms = Math.min(...rows.map((row) => row.bathrooms));
  payload.facing = rows.find((row) => row.facings.length)?.facings.join(", ") || "";
  return payload;
}

function normalizePlotDimensions(value) {
  if (!String(value || "").trim()) return "";
  const match = String(value)
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|')?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')?$/i);
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
    throw new PropertyPayloadError("Plot dimensions must use positive width × length values in feet, for example 40 ft × 60 ft");
  }
  return `${Number(match[1])} ft × ${Number(match[2])} ft`;
}

function normalizeFloorCount(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  const compact = normalized.replace(/\b(?:upper\s+)?floors?\b/gi, "").trim();
  if (/^(?:g|ground(?:\s+floor)?)$/i.test(compact)) return "G";
  const ground = compact.match(/^(?:g|ground(?:\s+floor)?)\s*(?:\+|plus)\s*([1-9]\d*)$/i);
  if (ground) return `G+${Number(ground[1])}`;
  const numeric = compact.match(/^([1-9]\d*)$/);
  if (numeric) return String(Number(numeric[1]));
  throw new PropertyPayloadError("Number of floors must be G, G+N, Ground + N Floors, or a positive whole number");
}

function normalizeVillaPayload(input, { requireStructured = false } = {}) {
  const payload = { ...input };
  const details = payload.villaDetails;
  if (!details && !requireStructured) return payload;
  if (!details || typeof details !== "object") {
    throw new PropertyPayloadError("Villa details are required");
  }
  if (!VILLA_TYPES.has(details.villaType)) {
    throw new PropertyPayloadError("Select a supported Villa type");
  }
  if (!Array.isArray(details.configurationDetails) || details.configurationDetails.length === 0) {
    throw new PropertyPayloadError("At least one Villa configuration is required");
  }

  const rows = details.configurationDetails.map((row) => {
    const configuration = normalizeVillaConfiguration(row.configuration);
    const configurationBhk = configuration.match(/(\d+(?:\.5)?)\s*BHK\b/i)?.[0] || "";
    const bhk = normalizeVillaBhk(row.bhk || configurationBhk);
    const bedrooms = optionalInteger(row.bedrooms, `${configuration} bedrooms`, 1);
    const expectedBedrooms = bhk ? Math.floor(Number(bhk.match(/^\d+(?:\.5)?/)[0])) : undefined;
    if (bedrooms !== undefined && expectedBedrooms !== undefined && bedrooms !== expectedBedrooms) {
      throw new PropertyPayloadError(`${configuration} bedrooms must equal ${expectedBedrooms}`);
    }
    const bathrooms = optionalInteger(row.bathrooms, `${configuration} bathrooms`, 1);
    const balconies = optionalInteger(row.balconies, `${configuration} balconies`, 0);
    const inferredVariant = inferVillaUnitVariant(configuration);
    const unitVariant = String(row.unitVariant || inferredVariant || "").trim();
    if (unitVariant && !VILLA_UNIT_VARIANTS.has(unitVariant)) {
      throw new PropertyPayloadError(`${configuration} unit variant is invalid`);
    }
    const rowFacing = String(row.plotFacing || "").trim();
    if (rowFacing && !FACING_OPTIONS.has(rowFacing)) {
      throw new PropertyPayloadError(`${configuration}: ${FACING_ERROR_MESSAGE}`);
    }
    const rowRoadWidth = String(row.roadWidthFacing || "").trim();
    if (rowRoadWidth && (!Number.isFinite(parseNumericDisplay(rowRoadWidth, "area")) || parseNumericDisplay(rowRoadWidth, "area") <= 0)) {
      throw new PropertyPayloadError(`${configuration} road width facing must contain a positive number`);
    }
    const privateGarden = Boolean(row.privateGarden);
    return {
      configuration,
      bhk,
      unitVariant: unitVariant || undefined,
      price: optionalPositiveDisplay(row.price, `${configuration} price`, "price"),
      plotArea: optionalPositiveDisplay(row.plotArea, `${configuration} plot area`),
      builtUpArea: optionalPositiveDisplay(row.builtUpArea, `${configuration} built-up area`),
      carpetArea: optionalPositiveDisplay(row.carpetArea, `${configuration} carpet area`),
      superArea: optionalPositiveDisplay(row.superArea, `${configuration} super area`),
      bedrooms,
      bathrooms,
      balconies,
      plotDimensions: normalizePlotDimensions(row.plotDimensions),
      numberOfFloors: normalizeFloorCount(row.numberOfFloors || configuration.match(/\((G\+\d+|\d+)\)/i)?.[1]),
      plotFacing: rowFacing || undefined,
      cornerPlot: Boolean(row.cornerPlot),
      roadWidthFacing: rowRoadWidth,
      privateGarden,
      privateGardenArea: privateGarden && row.privateGardenArea
        ? requirePositiveDisplay(row.privateGardenArea, `${configuration} private garden area`)
        : "",
      privatePool: Boolean(row.privatePool),
      terrace: Boolean(row.terrace),
      terraceDetails: row.terrace ? String(row.terraceDetails || "").trim() : "",
      gatedCommunity: Boolean(row.gatedCommunity),
    };
  });

  const tags = Array.isArray(payload.configs) ? payload.configs.map(normalizeVillaConfiguration) : [];
  if (tags.length !== rows.length || tags.some((tag, index) => tag !== rows[index].configuration)) {
    throw new PropertyPayloadError("Configuration tags and Villa detail rows must match in the same order");
  }
  if (details.plotFacing && !FACING_OPTIONS.has(details.plotFacing)) throw new PropertyPayloadError(FACING_ERROR_MESSAGE.replace(/^Plot/, "Villa plot"));

  const possession = payload.possessionDetails;
  if (!possession || !VILLA_POSSESSION_STATUSES.has(possession.status)) {
    throw new PropertyPayloadError("Villa possession status must be Ready to Move or Under Construction");
  }
  const underConstruction = possession.status === "Under Construction";
  if (underConstruction) {
    if (!isCompletionMonth(possession.expectedCompletionDate) || possession.launchDate) {
      throw new PropertyPayloadError("Under Construction requires only an expected completion month and year");
    }
  } else if (!isCalendarDate(possession.launchDate) || possession.expectedCompletionDate) {
    throw new PropertyPayloadError("Ready to Move requires only a Ready Since date");
  }

  const privateGarden = Boolean(details.privateGarden);
  const terrace = Boolean(details.terrace);
  const roadWidthFacing = String(details.roadWidthFacing || "").trim();
  if (roadWidthFacing && (!Number.isFinite(parseNumericDisplay(roadWidthFacing, "area")) || parseNumericDisplay(roadWidthFacing, "area") <= 0)) {
    throw new PropertyPayloadError("Road width facing must contain a positive number");
  }
  if (payload.furnishing && !FURNISHING_OPTIONS.has(payload.furnishing)) {
    throw new PropertyPayloadError("Villa furnishing must be Unfurnished, Semi-Furnished, or Fully Furnished");
  }
  payload.builder = requireText(payload.builder, "Villa builder/developer");
  if (payload.transactionType !== "New Property") {
    throw new PropertyPayloadError(payload.transactionType === "Resale" ? "Resale properties are not applicable" : "Villa transaction type must be New Property");
  }
  if (!["For Sale", "For Rent"].includes(payload.listingType)) {
    throw new PropertyPayloadError("Villa listing type must be For Sale or For Rent");
  }
  validateSharedStructuredFields(payload, "Villa");

  payload.villaDetails = {
    villaType: details.villaType,
    configurationDetails: rows,
    plotDimensions: normalizePlotDimensions(details.plotDimensions),
    numberOfFloors: normalizeFloorCount(details.numberOfFloors),
    plotFacing: details.plotFacing,
    cornerPlot: Boolean(details.cornerPlot),
    roadWidthFacing,
    privateGarden,
    privateGardenArea: privateGarden
      ? optionalPositiveDisplay(details.privateGardenArea, "Private garden area")
      : "",
    privatePool: Boolean(details.privatePool),
    terrace,
    terraceDetails: terrace ? String(details.terraceDetails || "").trim() : "",
    gatedCommunity: Boolean(details.gatedCommunity),
  };
  payload.configurationDetails = undefined;
  payload.commercialDetails = undefined;
  payload.pgDetails = undefined;
  payload.floorLabel = undefined;
  payload.totalFloors = undefined;
  payload.ownershipType = undefined;
  payload.overlooking = undefined;
  payload.bookingAmount = undefined;
  payload.configs = rows.map((row) => row.configuration);
  payload.price = deriveRange(rows, "price") || payload.price;
  payload.area = deriveRange(rows, "superArea") || deriveRange(rows, "builtUpArea") || deriveRange(rows, "carpetArea") || deriveRange(rows, "plotArea") || payload.area;
  const bedroomValues = rows.flatMap((row) => row.bedrooms === undefined ? [] : [row.bedrooms]);
  const bathroomValues = rows.flatMap((row) => row.bathrooms === undefined ? [] : [row.bathrooms]);
  payload.bedrooms = bedroomValues.length ? Math.min(...bedroomValues) : payload.bedrooms;
  payload.bathrooms = bathroomValues.length ? Math.min(...bathroomValues) : payload.bathrooms;
  payload.facing = rows.find((row) => row.plotFacing)?.plotFacing || details.plotFacing || "";
  payload.possessionDetails = {
    status: possession.status,
    launchDate: underConstruction ? "" : possession.launchDate,
    expectedCompletionDate: underConstruction ? possession.expectedCompletionDate : "",
  };
  payload.possession = possession.status;
  payload.ageOfProperty = underConstruction ? "Under Construction" : "";
  return payload;
}

function normalizePlotSize(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|')?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')?$/i);
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
    throw new PropertyPayloadError("Plot sizes must use positive width × length values in feet, for example 30 × 40");
  }
  const width = Number(match[1]);
  const length = Number(match[2]);
  return { plotSize: `${width} × ${length}`, width, length, areaSqft: width * length };
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function formatIndianPrice(value) {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(value % 10000000 === 0 ? 0 : 2)} Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(value % 100000 === 0 ? 0 : 2)} L`;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

function normalizePlotPayload(input, { requireStructured = false } = {}) {
  const payload = { ...input };
  const details = payload.plotDetails;
  if (!details && !requireStructured) return payload;
  if (!details || typeof details !== "object") throw new PropertyPayloadError("Plot details are required");
  if (!Array.isArray(details.plotSizeDetails) || details.plotSizeDetails.length === 0) {
    throw new PropertyPayloadError("At least one plot size is required");
  }

  const seenSizes = new Set();
  const rows = details.plotSizeDetails.map((row, index) => {
    const size = normalizePlotSize(row.plotSize);
    const key = size.plotSize.toLowerCase();
    if (seenSizes.has(key)) throw new PropertyPayloadError(`Duplicate plot size: ${size.plotSize}`);
    seenSizes.add(key);
    const pricePerSqft = Number(row.pricePerSqft);
    if (!Number.isFinite(pricePerSqft) || pricePerSqft <= 0) {
      throw new PropertyPayloadError(`${size.plotSize} price per sqft must be a positive number`);
    }
    const facings = Array.isArray(row.facings) ? [...new Set(row.facings.map((value) => String(value).trim()).filter(Boolean))] : [];
    if (facings.some((facing) => !FACING_OPTIONS.has(facing))) {
      throw new PropertyPayloadError(`${size.plotSize} contains invalid facing options`);
    }
    return { ...size, pricePerSqft, totalPrice: Math.round(size.areaSqft * pricePerSqft), facings };
  });

  const tags = Array.isArray(payload.configs) ? payload.configs.map((value) => normalizePlotSize(value).plotSize) : [];
  if (tags.length !== rows.length || tags.some((tag, index) => tag !== rows[index].plotSize)) {
    throw new PropertyPayloadError("Plot-size tags and detail rows must match in the same order");
  }
  const totalPlots = requireInteger(details.totalPlots, "Number of plots", 1);
  if (!Array.isArray(details.inventory) || details.inventory.length !== totalPlots) {
    const inventoryCount = Array.isArray(details.inventory) ? details.inventory.length : 0;
    throw new PropertyPayloadError(`Plot inventory has ${inventoryCount} row${inventoryCount === 1 ? "" : "s"}, but the declared number of plots is ${totalPlots}`);
  }
  const validSizes = new Set(rows.map((row) => row.plotSize));
  const seenPlotNumbers = new Set();
  const inventory = details.inventory.map((item, index) => {
    const plotNumber = requireText(item.plotNumber, `Plot ${index + 1} number`);
    const key = plotNumber.toLowerCase();
    if (seenPlotNumbers.has(key)) throw new PropertyPayloadError(`Duplicate plot number: ${plotNumber}`);
    seenPlotNumbers.add(key);
    const plotSize = normalizePlotSize(item.plotSize).plotSize;
    if (!validSizes.has(plotSize)) throw new PropertyPayloadError(`Plot ${plotNumber} uses a plot size that is not listed above`);
    const facing = String(item.facing || "").trim();
    if (facing && !FACING_OPTIONS.has(facing)) throw new PropertyPayloadError(`Plot ${plotNumber} must have a valid facing when one is provided`);
    if (!PLOT_INVENTORY_STATUSES.has(item.status)) throw new PropertyPayloadError(`Plot ${plotNumber} must have a valid inventory status`);
    return { plotNumber, plotSize, facing: facing || undefined, status: item.status, isCorner: requireBoolean(item.isCorner, `Plot ${plotNumber} corner flag`) };
  });
  const approvalAuthority = requireText(details.approvalAuthority, "Layout approval authority").slice(0, 120);
  if (!PLOT_APPROVAL_AUTHORITIES.has(approvalAuthority) && approvalAuthority.length < 2) {
    throw new PropertyPayloadError("Enter a valid custom layout approval authority");
  }
  if (!["image", "pdf"].includes(details.layoutMapType) || !isHttpUrl(details.layoutMapUrl)) {
    throw new PropertyPayloadError("A valid master plan or layout-map upload is required");
  }
  const civic = details.civicInfrastructure || {};
  for (const field of ["undergroundDrainage", "electricity", "water"]) {
    if (!["Ready", "Under Development"].includes(civic[field])) {
      throw new PropertyPayloadError(`Civic infrastructure ${field} must be Ready or Under Development`);
    }
  }
  const layoutPossession = details.layoutPossession || {};
  if (!PLOT_LAYOUT_STATUSES.has(layoutPossession.status)) throw new PropertyPayloadError("A valid layout possession status is required");
  const underDevelopment = layoutPossession.status === "Under Development";
  if (underDevelopment) {
    if (!isCompletionMonth(layoutPossession.expectedCompletionDate) || layoutPossession.readyDate) {
      throw new PropertyPayloadError("Under Development requires only an expected completion month and year");
    }
  } else if (!isCalendarDate(layoutPossession.readyDate) || layoutPossession.expectedCompletionDate) {
    throw new PropertyPayloadError("Layout Ready requires only a ready date");
  }
  const roadWidth = String(details.roadWidth || "").trim();
  if (roadWidth && (!Number.isFinite(parseNumericDisplay(roadWidth, "area")) || parseNumericDisplay(roadWidth, "area") <= 0)) {
    throw new PropertyPayloadError("Road width must contain a positive number");
  }
  payload.builder = requireText(payload.builder, "Plot builder/developer");
  if (payload.transactionType !== 'New Property') throw new PropertyPayloadError(payload.transactionType === "Resale" ? "Resale properties are not applicable" : "Plot transaction type must be New Property");
  if (!['For Sale', 'For Rent'].includes(payload.listingType)) throw new PropertyPayloadError("Plot listing type must be For Sale or For Rent");
  validateSharedStructuredFields(payload, "Plot");

  payload.plotDetails = {
    plotSizeDetails: rows,
    totalPlots,
    approvalAuthority,
    approvalNumber: String(details.approvalNumber || "").trim(),
    roadWidth,
    civicInfrastructure: { undergroundDrainage: civic.undergroundDrainage, electricity: civic.electricity, water: civic.water },
    layoutMapUrl: details.layoutMapUrl,
    layoutMapType: details.layoutMapType,
    layoutPossession: {
      status: layoutPossession.status,
      readyDate: underDevelopment ? "" : layoutPossession.readyDate,
      expectedCompletionDate: underDevelopment ? layoutPossession.expectedCompletionDate : "",
    },
    inventory,
  };
  payload.configurationDetails = undefined;
  payload.villaDetails = undefined;
  payload.commercialDetails = undefined;
  payload.pgDetails = undefined;
  payload.possessionDetails = undefined;
  payload.floorLabel = undefined;
  payload.totalFloors = undefined;
  payload.ownershipType = undefined;
  payload.overlooking = undefined;
  payload.bookingAmount = undefined;
  payload.furnishing = undefined;
  payload.parking = undefined;
  payload.configs = rows.map((row) => row.plotSize);
  payload.price = rows.length === 1 ? formatIndianPrice(rows[0].totalPrice) : `${formatIndianPrice(Math.min(...rows.map((row) => row.totalPrice)))} - ${formatIndianPrice(Math.max(...rows.map((row) => row.totalPrice)))}`;
  payload.pricePerSqft = rows.length === 1 ? `₹${rows[0].pricePerSqft.toLocaleString("en-IN")}/sqft` : `₹${Math.min(...rows.map((row) => row.pricePerSqft)).toLocaleString("en-IN")}/sqft - ₹${Math.max(...rows.map((row) => row.pricePerSqft)).toLocaleString("en-IN")}/sqft`;
  payload.area = rows.length === 1 ? `${rows[0].areaSqft} sqft` : `${Math.min(...rows.map((row) => row.areaSqft))} - ${Math.max(...rows.map((row) => row.areaSqft))} sqft`;
  payload.bedrooms = undefined;
  payload.bathrooms = undefined;
  payload.facing = rows.find((row) => row.facings.length)?.facings.join(", ") || "";
  payload.possession = layoutPossession.status;
  payload.ageOfProperty = underDevelopment ? "Under Construction" : "";
  const badges = Array.isArray(payload.badges) ? payload.badges.filter((badge) => badge !== "Corner Plot") : [];
  if (inventory.some((item) => item.isCorner && item.status === "Available")) badges.push("Corner Plot");
  payload.badges = badges;
  return payload;
}

function normalizeCommercialPayload(input, { requireStructured = false } = {}) {
  const payload = { ...input };
  const details = payload.commercialDetails;
  if (!details && !requireStructured) return payload;
  if (!details || typeof details !== "object") throw new PropertyPayloadError("Commercial details are required");
  if (!COMMERCIAL_SUBTYPES.has(details.commercialSubtype)) throw new PropertyPayloadError("Select a valid commercial subtype");
  const areas = ["carpetArea", "builtUpArea", "superArea"].reduce((result, key) => ({ ...result, [key]: String(details[key] || "").trim() }), {});
  if (!Object.values(areas).some(Boolean)) throw new PropertyPayloadError("Enter at least one commercial area");
  for (const [key, value] of Object.entries(areas)) if (value) requirePositiveDisplay(value, key.replace(/Area$/, " area"));
  const floor = requireText(details.floor, "Commercial floor");
  const totalFloors = requireInteger(details.totalFloors, "Total floors", 1);
  if (/^[1-9]\d*$/.test(floor) && Number(floor) > totalFloors) throw new PropertyPayloadError("Commercial floor cannot be higher than total floors");
  if (!COMMERCIAL_ZONES.has(details.zoneType)) throw new PropertyPayloadError("Select a valid commercial zone type");
  if (!COMMERCIAL_GRADES.has(details.buildingGrade)) throw new PropertyPayloadError("Select a valid building grade");
  if (!COMMERCIAL_PANTRIES.has(details.pantry)) throw new PropertyPayloadError("Select a valid pantry option");
  if (!COMMERCIAL_FURNISHING.has(details.furnishing)) throw new PropertyPayloadError("Select a valid commercial furnishing option");
  const officeLike = ["Office Space", "Co-working"].includes(details.commercialSubtype);
  const frontage = String(details.frontage || "").trim();
  if (details.commercialSubtype === "Shop/Showroom" && !frontage) throw new PropertyPayloadError("Frontage is required for a Shop/Showroom");
  if (frontage) requirePositiveDisplay(frontage, "Frontage");
  const possession = payload.possessionDetails;
  if (!possession || !VILLA_POSSESSION_STATUSES.has(possession.status)) throw new PropertyPayloadError("Commercial possession status must be Ready to Move or Under Construction");
  const underConstruction = possession.status === "Under Construction";
  if (underConstruction ? (!isCompletionMonth(possession.expectedCompletionDate) || possession.launchDate) : (!isCalendarDate(possession.launchDate) || possession.expectedCompletionDate)) {
    throw new PropertyPayloadError(underConstruction ? "Under Construction requires only an expected completion month and year" : "Ready to Move requires only a ready date");
  }
  payload.builder = requireText(payload.builder, "Commercial builder/developer");
  if (payload.transactionType !== 'New Property') throw new PropertyPayloadError(payload.transactionType === "Resale" ? "Resale properties are not applicable" : "Commercial transaction type must be New Property");
  if (!['For Sale', 'For Rent'].includes(payload.listingType)) throw new PropertyPayloadError("Commercial listing type must be For Sale or For Rent");
  validateSharedStructuredFields(payload, "Commercial");
  payload.commercialDetails = {
    commercialSubtype: details.commercialSubtype, ...areas, floor, totalFloors, frontage,
    zoneType: details.zoneType, seatingCapacity: officeLike ? requireInteger(details.seatingCapacity ?? 0, "Seating capacity", 0) : 0,
    cabins: officeLike ? requireInteger(details.cabins ?? 0, "Cabins", 0) : 0,
    meetingRooms: officeLike ? requireInteger(details.meetingRooms ?? 0, "Meeting rooms", 0) : 0,
    buildingGrade: details.buildingGrade, structure: String(details.structure || "").trim(), pantry: details.pantry,
    washrooms: String(details.washrooms || "").trim(), parking: String(details.parking || "").trim(),
    powerBackup: String(details.powerBackup || "").trim(), sanctionedLoadKva: requireInteger(details.sanctionedLoadKva ?? 0, "Sanctioned load", 0),
    fireSafetyCompliance: String(details.fireSafetyCompliance || "").trim(), furnishing: details.furnishing,
  };
  payload.configurationDetails = undefined; payload.villaDetails = undefined; payload.plotDetails = undefined; payload.pgDetails = undefined;
  payload.floorLabel = undefined; payload.totalFloors = undefined; payload.bedrooms = undefined; payload.bathrooms = undefined;
  payload.facing = undefined; payload.furnishing = undefined; payload.parking = undefined; payload.ownershipType = undefined;
  payload.bookingAmount = undefined;
  payload.configs = [details.commercialSubtype];
  payload.area = areas.superArea || areas.builtUpArea || areas.carpetArea;
  payload.possessionDetails = { status: possession.status, launchDate: underConstruction ? "" : possession.launchDate, expectedCompletionDate: underConstruction ? possession.expectedCompletionDate : "" };
  payload.possession = possession.status; payload.ageOfProperty = underConstruction ? "Under Construction" : "";
  return payload;
}

function normalizePgPayload(input, { requireStructured = false } = {}) {
  const payload = { ...input }; const details = payload.pgDetails;
  if (!details && !requireStructured) return payload;
  if (!details || typeof details !== "object") throw new PropertyPayloadError("PG / Co-living details are required");
  if (!["Men only", "Women only", "Co-ed"].includes(details.genderPreference)) throw new PropertyPayloadError("Select a valid gender preference");
  if (!Array.isArray(details.sharingDetails) || !details.sharingDetails.length) throw new PropertyPayloadError("Add at least one sharing type");
  const seen = new Set(); const rows = details.sharingDetails.map((row) => { if (!PG_SHARING_TYPES.has(row.sharingType) || seen.has(row.sharingType)) throw new PropertyPayloadError("Sharing types must be valid and unique"); seen.add(row.sharingType); return { sharingType: row.sharingType, rentPerBed: requireInteger(row.rentPerBed, `${row.sharingType} rent per bedroom space`, 1), deposit: requireInteger(row.deposit, `${row.sharingType} deposit`, 0), bedsAvailable: requireInteger(row.bedsAvailable, `${row.sharingType} bedroom spaces available`, 0) }; });
  if (!["Breakfast + Dinner", "All 3 meals", "No meals"].includes(details.mealsIncluded)) throw new PropertyPayloadError("Select a valid meals option");
  const hasMeals = details.mealsIncluded !== "No meals";
  if (hasMeals && !["Veg only", "Veg + Non-veg"].includes(details.foodType)) throw new PropertyPayloadError("Food type is required when meals are included");
  if (details.laundryIncluded && !String(details.laundrySchedule || "").trim()) throw new PropertyPayloadError("Laundry schedule is required when laundry is included");
  if (!isCalendarDate(details.availableFrom)) throw new PropertyPayloadError("Available-from date is required");
  if (!["Owner", "PG Manager", "Company-run"].includes(details.contactType)) throw new PropertyPayloadError("Select a valid owner/manager contact type");
  validateSharedStructuredFields(payload, "PG / Co-living");
  payload.pgDetails = { genderPreference: details.genderPreference, sharingDetails: rows, mealsIncluded: details.mealsIncluded, foodType: hasMeals ? details.foodType : "", wifiIncluded: requireBoolean(details.wifiIncluded, "Wi-Fi included"), laundryIncluded: requireBoolean(details.laundryIncluded, "Laundry included"), laundrySchedule: details.laundryIncluded ? String(details.laundrySchedule).trim() : "", housekeeping: String(details.housekeeping || "").trim(), curfewEntryTiming: String(details.curfewEntryTiming || "").trim(), visitorsAllowed: String(details.visitorsAllowed || "").trim(), noticePeriod: String(details.noticePeriod || "").trim(), lockInPeriod: String(details.lockInPeriod || "").trim(), idProofRequired: String(details.idProofRequired || "").trim(), utilitiesIncluded: String(details.utilitiesIncluded || "").trim(), availableFrom: details.availableFrom, commonAmenities: Array.isArray(details.commonAmenities) ? [...new Set(details.commonAmenities.map(String))] : [], contactType: details.contactType };
  payload.configurationDetails = undefined; payload.villaDetails = undefined; payload.plotDetails = undefined; payload.commercialDetails = undefined; payload.possessionDetails = undefined; payload.bedrooms = undefined; payload.bathrooms = undefined; payload.floorLabel = undefined; payload.totalFloors = undefined; payload.furnishing = undefined; payload.parking = undefined; payload.facing = undefined; payload.configs = rows.map((row) => row.sharingType); payload.price = `₹${Math.min(...rows.map((row) => row.rentPerBed)).toLocaleString("en-IN")}/month`; payload.pricePerSqft = ""; payload.area = ""; payload.possession = `Available from ${details.availableFrom}`; payload.ageOfProperty = ""; return payload;
}
module.exports = {
  FACING_OPTIONS,
  FACING_ERROR_MESSAGE,
  PropertyPayloadError,
  normalizeKarnatakaReraUrl,
  normalizeConfiguration,
  normalizeApartmentPayload,
  normalizeVillaPayload,
  normalizePlotPayload,
  normalizeCommercialPayload,
  normalizePgPayload,
};
