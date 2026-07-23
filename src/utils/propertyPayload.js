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
const VILLA_TYPES = new Set(["Independent", "Row Villa", "Twin Villa"]);
const VILLA_POSSESSION_STATUSES = new Set(["Ready to Move", "Under Construction"]);
const FURNISHING_OPTIONS = new Set(["Unfurnished", "Semi-Furnished", "Fully Furnished"]);
const PLOT_APPROVAL_AUTHORITIES = new Set(["BMRDA", "BDA", "DTCP", "Panchayat"]);
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

class PropertyPayloadError extends Error {
  constructor(message) {
    super(message);
    this.name = "PropertyPayloadError";
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

function validateSharedStructuredFields(payload, propertyLabel) {
  if (payload.reraRegistered) {
    const reraNumber = String(payload.reraNumber || "").trim();
    if (["Villa", "Plot", "Commercial"].includes(propertyLabel) && !/^[A-Za-z0-9/._-]{8,50}$/.test(reraNumber)) {
      throw new PropertyPayloadError(`${propertyLabel} RERA number must be 8-50 characters using letters, numbers, /, ., _, or -`);
    }
    if (!["Villa", "Plot", "Commercial"].includes(propertyLabel) && !reraNumber) {
      throw new PropertyPayloadError(`RERA number is required for a RERA-registered ${propertyLabel}`);
    }
    payload.reraNumber = reraNumber;
  } else {
    payload.reraNumber = "";
  }
  if (payload.locality?.pinCode && !/^\d{6}$/.test(payload.locality.pinCode)) {
    throw new PropertyPayloadError("PIN code must contain exactly 6 digits");
  }
  payload.facilities = normalizeFacilities(payload.facilities);
  payload.nearbyDetails = validateNearbyDetails(payload.nearbyDetails);
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
  for (const key of ["schools", "hospitals", "shopping", "metro"]) {
    const item = nearbyDetails[key];
    if (!item) continue;
    if ((item.count === undefined || item.count === null || item.count === "") && !String(item.distance || "").trim()) continue;
    result[key] = {
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
    const facings = Array.isArray(row.facings) ? [...new Set(row.facings.map((v) => String(v).trim()))] : [];
    if (facings.length === 0 || facings.some((facing) => !FACING_OPTIONS.has(facing))) {
      throw new PropertyPayloadError(`Configuration ${index + 1} must include valid facing options`);
    }
    return {
      id: String(row.id || `${configuration}-${index + 1}`).trim(),
      configuration,
      price: requireText(row.price, `${configuration} price`),
      superBuiltUpArea: requireText(row.superBuiltUpArea, `${configuration} super built-up area`),
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
  if (payload.transactionType === "New Property" && !String(payload.bookingAmount || "").trim()) {
    throw new PropertyPayloadError("Booking amount is required for a new Apartment");
  }
  if (payload.transactionType === "Resale") payload.bookingAmount = "";
  if (String(payload.description || "").trim().length < 50) {
    throw new PropertyPayloadError("Apartment description must contain at least 50 characters");
  }
  if (payload.floorLabel && !/^(?:[1-9]\d*|Ground|Basement(?:\s+\d+)?)$/i.test(payload.floorLabel.trim())) {
    throw new PropertyPayloadError("Floor must be a positive whole number, Ground, or Basement");
  }
  if (/^[1-9]\d*$/.test(String(payload.floorLabel || "")) && payload.totalFloors && Number(payload.floorLabel) > Number(payload.totalFloors)) {
    throw new PropertyPayloadError("Flat floor cannot be higher than total floors");
  }
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
  payload.area = deriveRange(rows, "superBuiltUpArea") || payload.area;
  payload.bedrooms = Math.min(...rows.map((row) => row.bedrooms));
  payload.bathrooms = Math.min(...rows.map((row) => row.bathrooms));
  payload.facing = rows[0].facings.join(", ");
  return payload;
}

function normalizePlotDimensions(value) {
  if (!String(value || "").trim()) return "";
  const match = String(value)
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|')?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')?$/i);
  if (!match || Number(match[1]) <= 0 || Number(match[2]) <= 0) {
    throw new PropertyPayloadError("Plot dimensions must use positive width × length values in feet, for example 40 ft × 60 ft");
  }
  return `${Number(match[1])} ft × ${Number(match[2])} ft`;
}

function normalizeFloorCount(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, "").toUpperCase();
  if (!normalized) return "";
  if (!/^(?:G(?:\+[1-9]\d*)?|[1-9]\d*)$/.test(normalized)) {
    throw new PropertyPayloadError("Number of floors must be G, G+N, or a positive whole number");
  }
  return normalized;
}

function normalizeVillaPayload(input, { requireStructured = false } = {}) {
  const payload = { ...input };
  const details = payload.villaDetails;
  if (!details && !requireStructured) return payload;
  if (!details || typeof details !== "object") {
    throw new PropertyPayloadError("Villa details are required");
  }
  if (!VILLA_TYPES.has(details.villaType)) {
    throw new PropertyPayloadError("Villa type must be Independent, Row Villa, or Twin Villa");
  }
  if (!Array.isArray(details.configurationDetails) || details.configurationDetails.length === 0) {
    throw new PropertyPayloadError("At least one Villa configuration is required");
  }

  const rows = details.configurationDetails.map((row) => {
    const configuration = normalizeConfiguration(row.configuration);
    const bedrooms = requireInteger(row.bedrooms, `${configuration} bedrooms`, 1);
    const expectedBedrooms = Number(configuration.match(/^\d+/)[0]);
    if (bedrooms !== expectedBedrooms) {
      throw new PropertyPayloadError(`${configuration} bedrooms must equal ${expectedBedrooms}`);
    }
    return {
      configuration,
      price: requirePositiveDisplay(row.price, `${configuration} price`, "price"),
      plotArea: requirePositiveDisplay(row.plotArea, `${configuration} plot area`),
      builtUpArea: requirePositiveDisplay(row.builtUpArea, `${configuration} built-up area`),
      superArea: requirePositiveDisplay(row.superArea, `${configuration} super area`),
      bedrooms,
      bathrooms: requireInteger(row.bathrooms, `${configuration} bathrooms`, 1),
    };
  });

  const tags = Array.isArray(payload.configs) ? payload.configs.map(normalizeConfiguration) : [];
  if (tags.length !== rows.length || tags.some((tag, index) => tag !== rows[index].configuration)) {
    throw new PropertyPayloadError("Configuration tags and Villa detail rows must match in the same order");
  }
  if (!FACING_OPTIONS.has(details.plotFacing)) throw new PropertyPayloadError("A valid Villa plot facing is required");

  const possession = payload.possessionDetails;
  if (!possession || !VILLA_POSSESSION_STATUSES.has(possession.status)) {
    throw new PropertyPayloadError("Villa possession status must be Ready to Move or Under Construction");
  }
  const underConstruction = possession.status === "Under Construction";
  if (underConstruction) {
    if (!isCalendarDate(possession.expectedCompletionDate) || possession.launchDate) {
      throw new PropertyPayloadError("Under Construction requires only an expected completion date");
    }
  } else if (!isCalendarDate(possession.launchDate) || possession.expectedCompletionDate) {
    throw new PropertyPayloadError("Ready to Move requires only a Ready Since date");
  }

  const privateGarden = requireBoolean(details.privateGarden, "Private garden");
  const terrace = requireBoolean(details.terrace, "Terrace");
  const roadWidthFacing = String(details.roadWidthFacing || "").trim();
  if (roadWidthFacing && (!Number.isFinite(parseNumericDisplay(roadWidthFacing, "area")) || parseNumericDisplay(roadWidthFacing, "area") <= 0)) {
    throw new PropertyPayloadError("Road width facing must contain a positive number");
  }
  if (payload.furnishing && !FURNISHING_OPTIONS.has(payload.furnishing)) {
    throw new PropertyPayloadError("Villa furnishing must be Unfurnished, Semi-Furnished, or Fully Furnished");
  }
  payload.builder = requireText(payload.builder, "Villa builder/developer");
  if (!["New Property", "Resale"].includes(payload.transactionType)) {
    throw new PropertyPayloadError("Villa transaction type must be New Property or Resale");
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
    cornerPlot: requireBoolean(details.cornerPlot, "Corner plot"),
    roadWidthFacing,
    privateGarden,
    privateGardenArea: privateGarden
      ? requirePositiveDisplay(details.privateGardenArea, "Private garden area")
      : "",
    privatePool: requireBoolean(details.privatePool, "Private pool"),
    terrace,
    terraceDetails: terrace ? String(details.terraceDetails || "").trim() : "",
    gatedCommunity: requireBoolean(details.gatedCommunity, "Gated community"),
  };
  payload.configurationDetails = undefined;
  payload.commercialDetails = undefined;
  payload.pgDetails = undefined;
  payload.floorLabel = undefined;
  payload.totalFloors = undefined;
  payload.ownershipType = undefined;
  payload.overlooking = undefined;
  payload.bookingAmount = payload.transactionType === "Resale" ? "" : payload.bookingAmount;
  payload.maintenanceCharges = undefined;
  payload.maintenancePeriod = undefined;
  payload.configs = rows.map((row) => row.configuration);
  payload.price = deriveRange(rows, "price") || payload.price;
  payload.area = deriveRange(rows, "superArea") || payload.area;
  payload.bedrooms = Math.min(...rows.map((row) => row.bedrooms));
  payload.bathrooms = Math.min(...rows.map((row) => row.bathrooms));
  payload.facing = details.plotFacing;
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
    .match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|')?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')?$/i);
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
    const facings = Array.isArray(row.facings) ? [...new Set(row.facings.map((value) => String(value).trim()))] : [];
    if (!facings.length || facings.some((facing) => !FACING_OPTIONS.has(facing))) {
      throw new PropertyPayloadError(`${size.plotSize} must include valid facing options`);
    }
    return { ...size, pricePerSqft, totalPrice: Math.round(size.areaSqft * pricePerSqft), facings };
  });

  const tags = Array.isArray(payload.configs) ? payload.configs.map((value) => normalizePlotSize(value).plotSize) : [];
  if (tags.length !== rows.length || tags.some((tag, index) => tag !== rows[index].plotSize)) {
    throw new PropertyPayloadError("Plot-size tags and detail rows must match in the same order");
  }
  const totalPlots = requireInteger(details.totalPlots, "Number of plots", 1);
  if (!Array.isArray(details.inventory) || details.inventory.length !== totalPlots) {
    throw new PropertyPayloadError("Plot inventory must contain exactly the declared number of plots");
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
    if (!FACING_OPTIONS.has(item.facing)) throw new PropertyPayloadError(`Plot ${plotNumber} must have a valid facing`);
    if (!PLOT_INVENTORY_STATUSES.has(item.status)) throw new PropertyPayloadError(`Plot ${plotNumber} must have a valid inventory status`);
    return { plotNumber, plotSize, facing: item.facing, status: item.status, isCorner: requireBoolean(item.isCorner, `Plot ${plotNumber} corner flag`) };
  });
  if (!PLOT_APPROVAL_AUTHORITIES.has(details.approvalAuthority)) throw new PropertyPayloadError("A valid layout approval authority is required");
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
    if (!isCalendarDate(layoutPossession.expectedCompletionDate) || layoutPossession.readyDate) {
      throw new PropertyPayloadError("Under Development requires only an expected completion date");
    }
  } else if (!isCalendarDate(layoutPossession.readyDate) || layoutPossession.expectedCompletionDate) {
    throw new PropertyPayloadError("Layout Ready requires only a ready date");
  }
  const roadWidth = String(details.roadWidth || "").trim();
  if (roadWidth && (!Number.isFinite(parseNumericDisplay(roadWidth, "area")) || parseNumericDisplay(roadWidth, "area") <= 0)) {
    throw new PropertyPayloadError("Road width must contain a positive number");
  }
  payload.builder = requireText(payload.builder, "Plot builder/developer");
  if (!['New Property', 'Resale'].includes(payload.transactionType)) throw new PropertyPayloadError("Plot transaction type must be New Property or Resale");
  if (!['For Sale', 'For Rent'].includes(payload.listingType)) throw new PropertyPayloadError("Plot listing type must be For Sale or For Rent");
  validateSharedStructuredFields(payload, "Plot");

  payload.plotDetails = {
    plotSizeDetails: rows,
    totalPlots,
    approvalAuthority: details.approvalAuthority,
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
  payload.maintenanceCharges = undefined;
  payload.maintenancePeriod = undefined;
  payload.furnishing = undefined;
  payload.parking = undefined;
  payload.configs = rows.map((row) => row.plotSize);
  payload.price = rows.length === 1 ? formatIndianPrice(rows[0].totalPrice) : `${formatIndianPrice(Math.min(...rows.map((row) => row.totalPrice)))} - ${formatIndianPrice(Math.max(...rows.map((row) => row.totalPrice)))}`;
  payload.pricePerSqft = rows.length === 1 ? `₹${rows[0].pricePerSqft.toLocaleString("en-IN")}/sqft` : `₹${Math.min(...rows.map((row) => row.pricePerSqft)).toLocaleString("en-IN")}/sqft - ₹${Math.max(...rows.map((row) => row.pricePerSqft)).toLocaleString("en-IN")}/sqft`;
  payload.area = rows.length === 1 ? `${rows[0].areaSqft} sqft` : `${Math.min(...rows.map((row) => row.areaSqft))} - ${Math.max(...rows.map((row) => row.areaSqft))} sqft`;
  payload.bedrooms = undefined;
  payload.bathrooms = undefined;
  payload.facing = rows[0].facings.join(", ");
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
  if (underConstruction ? (!isCalendarDate(possession.expectedCompletionDate) || possession.launchDate) : (!isCalendarDate(possession.launchDate) || possession.expectedCompletionDate)) {
    throw new PropertyPayloadError(underConstruction ? "Under Construction requires only an expected completion date" : "Ready to Move requires only a ready date");
  }
  payload.builder = requireText(payload.builder, "Commercial builder/developer");
  if (!['New Property', 'Resale'].includes(payload.transactionType)) throw new PropertyPayloadError("Commercial transaction type must be New Property or Resale");
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
  payload.facing = undefined; payload.furnishing = undefined; payload.parking = undefined; payload.ownershipType = payload.ownershipType || "";
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
  const seen = new Set(); const rows = details.sharingDetails.map((row) => { if (!PG_SHARING_TYPES.has(row.sharingType) || seen.has(row.sharingType)) throw new PropertyPayloadError("Sharing types must be valid and unique"); seen.add(row.sharingType); return { sharingType: row.sharingType, rentPerBed: requireInteger(row.rentPerBed, `${row.sharingType} rent per bed`, 1), deposit: requireInteger(row.deposit, `${row.sharingType} deposit`, 0), bedsAvailable: requireInteger(row.bedsAvailable, `${row.sharingType} beds available`, 0) }; });
  if (!["Breakfast + Dinner", "All 3 meals", "No meals"].includes(details.mealsIncluded)) throw new PropertyPayloadError("Select a valid meals option");
  const hasMeals = details.mealsIncluded !== "No meals";
  if (hasMeals && !["Veg only", "Veg + Non-veg"].includes(details.foodType)) throw new PropertyPayloadError("Food type is required when meals are included");
  if (details.laundryIncluded && !String(details.laundrySchedule || "").trim()) throw new PropertyPayloadError("Laundry schedule is required when laundry is included");
  if (!isCalendarDate(details.availableFrom)) throw new PropertyPayloadError("Available-from date is required");
  if (!["Owner", "PG Manager", "Company-run"].includes(details.contactType)) throw new PropertyPayloadError("Select a valid owner/manager contact type");
  validateSharedStructuredFields(payload, "PG / Co-living");
  payload.pgDetails = { genderPreference: details.genderPreference, sharingDetails: rows, mealsIncluded: details.mealsIncluded, foodType: hasMeals ? details.foodType : "", wifiIncluded: requireBoolean(details.wifiIncluded, "Wi-Fi included"), laundryIncluded: requireBoolean(details.laundryIncluded, "Laundry included"), laundrySchedule: details.laundryIncluded ? String(details.laundrySchedule).trim() : "", housekeeping: String(details.housekeeping || "").trim(), curfewEntryTiming: String(details.curfewEntryTiming || "").trim(), visitorsAllowed: String(details.visitorsAllowed || "").trim(), noticePeriod: String(details.noticePeriod || "").trim(), lockInPeriod: String(details.lockInPeriod || "").trim(), idProofRequired: String(details.idProofRequired || "").trim(), utilitiesIncluded: String(details.utilitiesIncluded || "").trim(), availableFrom: details.availableFrom, commonAmenities: Array.isArray(details.commonAmenities) ? [...new Set(details.commonAmenities.map(String))] : [], contactType: details.contactType };
  payload.configurationDetails = undefined; payload.villaDetails = undefined; payload.plotDetails = undefined; payload.commercialDetails = undefined; payload.possessionDetails = undefined; payload.bedrooms = undefined; payload.bathrooms = undefined; payload.floorLabel = undefined; payload.totalFloors = undefined; payload.furnishing = undefined; payload.parking = undefined; payload.facing = undefined; payload.reraRegistered = false; payload.reraNumber = ""; payload.configs = rows.map((row) => row.sharingType); payload.price = `₹${Math.min(...rows.map((row) => row.rentPerBed)).toLocaleString("en-IN")}/month`; payload.pricePerSqft = ""; payload.area = ""; payload.possession = `Available from ${details.availableFrom}`; payload.ageOfProperty = ""; return payload;
}
function getBrokerageBadges(badges, contactType) {
  const nextBadges = (badges || []).filter((badge) => badge !== "Zero Brokerage");
  if (contactType === "Owner") nextBadges.push("Zero Brokerage");
  return nextBadges;
}

function normalizeRentPayload(input, { requireStructured = false } = {}) {
  const payload = { ...input };
  const details = payload.rentDetails;

  if (!details && !requireStructured) return payload;
  if (!details || typeof details !== "object") {
    throw new PropertyPayloadError("Rent details are required");
  }
  if (!["Apartment", "Villa", "Independent House"].includes(details.rentalPropertyType)) {
    throw new PropertyPayloadError("Select a valid rental property type");
  }

  const configuration = String(details.configuration || "").trim();
  if (!configuration) throw new PropertyPayloadError("Rental configuration is required");

  const monthlyRent = requireInteger(details.monthlyRent, "Monthly rent", 1);
  const securityDeposit = requireInteger(details.securityDeposit, "Security deposit", 0);
  if (!["Included", "Extra"].includes(details.maintenanceMode)) {
    throw new PropertyPayloadError("Select a maintenance mode");
  }
  const maintenanceAmount = details.maintenanceMode === "Extra"
    ? requireInteger(details.maintenanceAmount, "Maintenance amount", 1)
    : 0;

  if (!isCalendarDate(details.availableFrom)) {
    throw new PropertyPayloadError("Available-from date is required");
  }
  if (!["Owner", "Broker"].includes(details.contactType)) {
    throw new PropertyPayloadError("Select Owner or Broker");
  }

  payload.rentDetails = {
    ...details,
    configuration,
    monthlyRent,
    securityDeposit,
    maintenanceAmount,
    preferredTenantTypes: Array.isArray(details.preferredTenantTypes)
      ? [...new Set(details.preferredTenantTypes.map(String))]
      : [],
  };
  payload.listingType = "For Rent";
  payload.configurationDetails = undefined;
  payload.villaDetails = undefined;
  payload.plotDetails = undefined;
  payload.commercialDetails = undefined;
  payload.pgDetails = undefined;
  payload.possessionDetails = undefined;
  payload.reraRegistered = false;
  payload.reraNumber = "";
  payload.configs = [configuration];
  payload.price = `₹${monthlyRent.toLocaleString("en-IN")}/month`;
  payload.area = details.superArea || details.carpetArea || "";
  payload.bedrooms = details.bedrooms;
  payload.bathrooms = details.bathrooms;
  payload.facing = details.facing;
  payload.parking = details.parking;
  payload.furnishing = details.furnishing;
  payload.badges = getBrokerageBadges(payload.badges, details.contactType);
  return payload;
}

function normalizeLeasePayload(input, { requireStructured = false } = {}) {
  const payload = { ...input };
  const details = payload.leaseDetails;

  if (!details && !requireStructured) return payload;
  if (!details) throw new PropertyPayloadError("Lease details are required");
  if (!["Commercial", "Residential"].includes(details.leasePropertyType)) {
    throw new PropertyPayloadError("Select a lease property type");
  }

  const leaseRent = requireInteger(details.leaseRent, "Lease rent", 1);
  const securityDeposit = requireInteger(details.securityDeposit, "Security deposit", 0);
  if (!String(details.leaseTenure || "").trim()) {
    throw new PropertyPayloadError("Lease tenure is required");
  }
  if (!isCalendarDate(details.availableFrom)) {
    throw new PropertyPayloadError("Available-from date is required");
  }
  if (!["Tenant", "Owner", "Shared"].includes(details.registrationStampDutyResponsibility)) {
    throw new PropertyPayloadError("Select registration responsibility");
  }
  if (!["Owner", "Broker"].includes(details.contactType)) {
    throw new PropertyPayloadError("Select Owner or Broker");
  }

  payload.leaseDetails = { ...details, leaseRent, securityDeposit };
  payload.listingType = "For Rent";
  payload.price = `₹${leaseRent.toLocaleString("en-IN")}/month`;
  payload.pricePerSqft = details.rentPerSqft ? `₹${details.rentPerSqft}/sqft` : "";
  payload.area = details.superArea || details.carpetArea || "";
  payload.configs = [details.leasePropertyType];
  payload.possession = `Available from ${details.availableFrom}`;
  payload.configurationDetails = undefined;
  payload.villaDetails = undefined;
  payload.plotDetails = undefined;
  payload.commercialDetails = undefined;
  payload.pgDetails = undefined;
  payload.rentDetails = undefined;
  payload.possessionDetails = undefined;
  payload.reraRegistered = false;
  payload.reraNumber = "";
  payload.badges = getBrokerageBadges(payload.badges, details.contactType);
  return payload;
}

module.exports = {
  FACING_OPTIONS,
  PropertyPayloadError,
  normalizeConfiguration,
  normalizeApartmentPayload,
  normalizeVillaPayload,
  normalizePlotPayload,
  normalizeCommercialPayload,
  normalizePgPayload,
  normalizeRentPayload,
  normalizeLeasePayload,
};
