const FACING_VALUES = new Set(["East", "West", "North", "South", "North-East", "North-West", "South-East", "South-West"]);
const RERA_URL = "https://rera.karnataka.gov.in/viewAllProjects";

function clean(value) {
  return String(value ?? "").trim();
}

function provided(value) {
  return Boolean(clean(value) && !/^(?:n\/?a|not\s+(?:provided|available))$/i.test(clean(value)));
}

function exactSections(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...String(text || "").matchAll(new RegExp(`(?:^|\\r?\\n)[\\t ]*\\[${escaped}(?:\\s*(?:#\\s*)?\\d+)?\\][\\t ]*(?:\\r?\\n|$)([\\s\\S]*?)(?=\\r?\\n[\\t ]*\\[[^\\]\\r\\n]+\\][\\t ]*(?:\\r?\\n|$)|$)`, "gi"))]
    .map((match) => match[1] || "");
}

function exactSection(text, name) {
  return exactSections(text, name)[0] || "";
}

function labelled(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text || "").match(new RegExp(`^[\\t ]*${escaped}[\\t ]*:[\\t ]*([^\\r\\n]*)[\\t ]*$`, "im"));
  const value = clean(match?.[1]);
  return provided(value) ? value : "";
}

function labelledValues(text, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...String(text || "").matchAll(new RegExp(`^[\\t ]*${escaped}[\\t ]*:[\\t ]*([^\\r\\n]*)[\\t ]*$`, "gim"))]
    .map((match) => clean(match[1]))
    .filter(provided);
}

function number(value) {
  const match = clean(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function areaToSqft(value) {
  const amount = number(value);
  if (amount === undefined) return undefined;
  return /acres?/i.test(clean(value)) ? amount * 43_560 : amount;
}

function areaToAcres(value) {
  const amount = number(value);
  if (amount === undefined) return undefined;
  return /(?:sq\.?\s*ft|sqft|square\s*feet)/i.test(clean(value)) ? amount / 43_560 : amount;
}

function normalizePropertyType(value) {
  const text = clean(value).toLowerCase();
  if (/apartment|flat/.test(text)) return "Apartment";
  if (/villa|mansion|row\s*house|penthouse/.test(text)) return "Villa";
  if (/plot|land/.test(text)) return "Plot";
  if (/commercial|office|warehouse|showroom/.test(text)) return "Commercial";
  if (/pg|co.?living|hostel/.test(text)) return "PG/Co-living";
  return "";
}

function normalizeFacing(value) {
  const aliases = {
    east: "East", west: "West", north: "North", south: "South",
    northeast: "North-East", northwest: "North-West", southeast: "South-East", southwest: "South-West",
  };
  const normalized = clean(value).toLowerCase().replace(/[^a-z]/g, "");
  const facing = aliases[normalized];
  return FACING_VALUES.has(facing) ? facing : "";
}

function importedFacings(value) {
  return [...new Set(clean(value).split(/[,;|/]/).map(normalizeFacing).filter(Boolean))];
}

function configurationName(value) {
  const source = clean(value);
  if (/\bstudio\b/i.test(source)) return "Studio";
  const match = source.match(/\b(\d+(?:\.5)?)\s*BHK\b/i);
  return match ? `${Number(match[1])} BHK` : source;
}

function keyDetailValue(data, expectedLabel) {
  const expected = clean(expectedLabel).toLowerCase().replace(/[^a-z0-9]/g, "");
  const row = (Array.isArray(data?.key_details) ? data.key_details : []).find((item) => {
    const label = Array.isArray(item) ? item[0] : item?.label;
    return clean(label).toLowerCase().replace(/[^a-z0-9]/g, "") === expected;
  });
  return clean(Array.isArray(row) ? row[1] : row?.value);
}

function formatIndianPrice(rupees) {
  if (!Number.isFinite(rupees) || rupees <= 0) return "";
  if (rupees >= 10_000_000) return `₹ ${(rupees / 10_000_000).toFixed(2)} Cr`;
  if (rupees >= 100_000) return `₹ ${(rupees / 100_000).toFixed(2)} Lac`;
  return `₹ ${Math.round(rupees).toLocaleString("en-IN")}`;
}

function configurationCandidatesFromMedia(staged) {
  const seen = new Set();
  return (Array.isArray(staged.assetManifest) ? staged.assetManifest : []).flatMap((row) => {
    if (!/^(?:approved|downloaded)$/i.test(clean(row?.status)) || !/^(?:floor_plan|3d_plan)$/i.test(clean(row?.kind))) return [];
    const source = `${clean(row.label)} ${clean(row.saved_as)}`;
    const bhk = source.match(/\b(\d+(?:\.5)?)\s*BHK\b/i)?.[1];
    const studio = /\bstudio\b/i.test(source);
    const area = source.replace(/,/g, "").match(/\b(\d{3,5}(?:\.\d+)?)\s*(?:Sq\.?\s*Ft\.?|sqft)\b/i)?.[1];
    if ((!bhk && !studio) || !area) return [];
    const configuration = studio ? "Studio" : `${Number(bhk)} BHK`;
    const key = `${configuration.toLowerCase()}:${Number(area)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ configuration, builtUpArea: `${Number(area)} Sq. Ft.`, bedrooms: studio ? 0 : Math.floor(Number(bhk)) }];
  });
}

function enrichConfigurationsFromPackage(staged, sourceRows) {
  const candidates = configurationCandidatesFromMedia(staged);
  if (!candidates.length) return sourceRows;
  const rate = number(keyDetailValue(staged.projectData, "Price Per Sq. Ft."));
  return candidates.map((candidate) => {
    const source = sourceRows.find((row) => row.configuration === candidate.configuration) || {};
    const area = number(candidate.builtUpArea);
    return {
      ...source,
      ...candidate,
      price: clean(source.price) || (rate && area ? formatIndianPrice(rate * area) : ""),
      carpetArea: clean(source.carpetArea),
      bathrooms: source.bathrooms,
      balconies: source.balconies,
      facings: source.facings || [],
    };
  });
}

function officialDetails(details = {}) {
  return {
    promoterName: clean(details.promoter_name),
    projectId: clean(details.project_id),
    acknowledgementNumber: clean(details.acknowledgement_number),
    registrationStatus: clean(details.status),
    district: clean(details.district),
    approvalDate: clean(details.approval_date),
    registeredCompletionDate: clean(details.registered_completion_date),
    registeredAddress: clean(details.registered_address),
    promoterAddress: clean(details.promoter_address),
  };
}

function nearbyKey(value) {
  const text = clean(value).toLowerCase();
  if (text.includes("school")) return "schools";
  if (text.includes("college")) return "colleges";
  if (text.includes("hospital")) return "hospitals";
  if (text.includes("shopping") || text.includes("mall")) return "shopping";
  if (text.includes("metro")) return "metro";
  if (text.includes("workplace") || text.includes("office") || text.includes("tech park")) return "workplaces";
  if (text.includes("park")) return "parks";
  if (text.includes("road")) return "roads";
  return "";
}

function possessionDetails(status, date) {
  if (status === "Under Construction") return { status, expectedCompletionDate: clean(date).match(/^20\d{2}-(?:0[1-9]|1[0-2])/)?.[0] || "" };
  if (status === "Ready to Move" || status === "New Launch") return { status, launchDate: /^20\d{2}-\d{2}-\d{2}$/.test(clean(date)) ? clean(date) : "" };
  return undefined;
}

function parsePropertyTemplate(staged) {
  const source = clean(staged.propertyUploadText);
  const data = staged.projectData || {};
  const basics = exactSection(source, "PROPERTY BASICS");
  const developer = exactSection(source, "DEVELOPER DETAILS");
  const inventory = exactSection(source, "PROJECT AREA AND INVENTORY");
  const location = exactSection(source, "LOCATION");
  const society = exactSection(source, "SOCIETY");
  const type = normalizePropertyType(labelled(basics, "Property Type")) || "Apartment";
  const warnings = [...(staged.validation?.warnings || [])];
  const configBlocks = exactSections(source, "CONFIGURATION");
  const sourceConfigurations = configBlocks.map((block) => {
    const rawName = labelled(block, "Configuration Name") || labelled(block, "BHK Configuration") || labelled(block, "BHK");
    const configuration = configurationName(rawName);
    return {
      configuration,
      price: labelled(block, "Price"),
      builtUpArea: labelled(block, "Built-up Area"),
      carpetArea: labelled(block, "Carpet Area"),
      superBuiltUpArea: labelled(block, "Super Area"),
      bedrooms: configuration === "Studio" ? 0 : number(labelled(block, "Bedrooms")) || number(configuration),
      bathrooms: number(labelled(block, "Bathrooms")),
      balconies: number(labelled(block, "Balconies")),
      facings: importedFacings(labelled(block, "Facings") || labelled(block, "Facing")),
    };
  }).filter((row) => row.configuration);
  const configurations = enrichConfigurationsFromPackage(staged, sourceConfigurations);

  const phaseBlocks = exactSections(source, "RERA PHASE");
  const stagedPhases = staged.reraPhases || [];
  const reraPhases = phaseBlocks.map((block, index) => {
    const reraNumber = labelled(block, "RERA Number");
    const packaged = stagedPhases.find((phase) => clean(phase.projectDetails?.rera_number).toLowerCase() === reraNumber.toLowerCase()) || stagedPhases[index];
    return {
      name: labelled(block, "Phase Name") || `Phase ${index + 1}`,
      reraNumber,
      reraSiteUrl: labelled(block, "RERA Website") || clean(packaged?.projectDetails?.search_url) || RERA_URL,
      order: index,
      officialDetails: officialDetails(packaged?.projectDetails),
      reraDocuments: [],
      projectDocuments: [],
    };
  }).filter((phase) => phase.reraNumber);
  if (!reraPhases.length) {
    stagedPhases.forEach((phase, index) => {
      const details = phase.projectDetails || {};
      if (!clean(details.rera_number)) return;
      reraPhases.push({ name: `Phase ${index + 1}`, reraNumber: clean(details.rera_number), reraSiteUrl: clean(details.search_url) || RERA_URL, order: index, officialDetails: officialDetails(details), reraDocuments: [], projectDocuments: [] });
    });
  }

  const facilities = exactSections(source, "AMENITY").map((block) => {
    const status = labelled(block, "Amenity Status");
    return { name: labelled(block, "Amenity Name"), description: labelled(block, "Amenity Description"), status: ["Available", "Planned", "Under Construction"].includes(status) ? status : "Available", category: "Amenities" };
  }).filter((row) => row.name);

  const nearbyDetails = {};
  exactSections(source, "NEARBY PLACE").forEach((block) => {
    const category = nearbyKey(labelled(block, "Category"));
    const name = labelled(block, "Place Name");
    if (!category || !name) return;
    const places = nearbyDetails[category]?.places || [];
    nearbyDetails[category] = { places: [...places, { name, distance: labelled(block, "Distance"), address: labelled(block, "Address"), landmark: labelled(block, "Landmark") }] };
  });

  const introduction = exactSections(source, "PROJECT INTRODUCTION").flatMap((block) => labelledValues(block, "Paragraph"));
  const usps = exactSections(source, "PROJECT USPS").flatMap((block) => labelledValues(block, "USP"));
  const investmentReasons = exactSections(source, "WHY INVEST").flatMap((block) => labelledValues(block, "Reason"));
  const locationAdvantage = exactSections(source, "LOCATION ADVANTAGES").flatMap((block) => labelledValues(block, "Advantage"));
  const keyDetails = exactSections(source, "PROJECT KEY DETAIL").map((block) => ({ label: labelled(block, "Label"), value: labelled(block, "Value") })).filter((row) => row.label && row.value);
  const featureGroups = exactSections(source, "PROJECT FEATURE GROUP").map((block) => ({ title: labelled(block, "Group Title"), items: labelledValues(block, "Item") })).filter((row) => row.title && row.items.length);
  const projectNarrative = { introduction, usps, investmentReasons, locationAdvantage, keyDetails, featureGroups };
  const masterBlock = exactSection(source, "MASTER PLAN");
  const masterPlan = {
    title: labelled(masterBlock, "Master Plan Section Title"),
    summary: labelled(masterBlock, "Verified Master Plan Description"),
    sections: exactSections(source, "MASTER PLAN DETAIL").map((block) => ({ heading: labelled(block, "Section Title"), body: labelled(block, "Section Description") })).filter((row) => row.heading && row.body),
  };
  const faqs = exactSections(source, "FAQ").map((block, index) => ({ question: labelled(block, "Question"), answer: labelled(block, "Answer"), order: index })).filter((row) => row.question && row.answer);
  const possession = labelled(basics, "Possession Status") || clean(data.possession_status);
  const completion = labelled(basics, "Expected Completion Month") || labelled(basics, "Ready / Launch Date") || clean(data.expected_completion || data.ready_launch_date);
  const totalAcres = areaToAcres(labelled(inventory, "Total Project Area") || clean(data.total_project_area));
  const openSpaceSqft = areaToSqft(labelled(inventory, "Open Space Area") || clean(data.open_space_area));
  const builtUpSqft = areaToSqft(labelled(inventory, "Project Built-up Area") || clean(data.project_built_up_area));
  const amenitiesSqft = areaToSqft(labelled(inventory, "Amenities Area") || clean(data.amenities_area));

  const payload = {
    title: labelled(basics, "Project / Property Name") || clean(data.project_name),
    subtitle: labelled(basics, "Title / Subtitle") || clean(data.title),
    description: labelled(basics, "Description"),
    propertyType: type,
    builder: labelled(basics, "Builder / Developer") || labelled(developer, "Developer Name") || clean(data.developer),
    developerDescription: labelled(developer, "About Developer") || clean(data.about_developer),
    transactionType: labelled(basics, "Transaction Type") || "New Property",
    listingType: labelled(basics, "Listing Type") || "For Sale",
    price: labelled(basics, "Price"),
    pricePerSqft: labelled(basics, "Price Per Sqft"),
    area: labelled(basics, "Total Area"),
    furnishing: labelled(basics, "Furnishing"),
    parking: labelled(basics, "Parking"),
    possession,
    possessionDetails: possessionDetails(possession, completion),
    configs: configurations.map((row) => row.configuration),
    configurationDetails: type === "Apartment" ? configurations : undefined,
    projectArea: [totalAcres, openSpaceSqft, builtUpSqft, amenitiesSqft].some((value) => value !== undefined) ? { totalAcres, openSpaceSqft, builtUpSqft, amenitiesSqft } : undefined,
    totalUnits: number(labelled(inventory, "Total Units") || data.total_units),
    totalTowers: number(labelled(inventory, "Total Towers") || data.total_towers),
    locality: {
      address: labelled(location, "Address") || clean(data.address), landmark: labelled(location, "Landmark") || clean(data.landmark),
      city: labelled(location, "City") || clean(data.city), zone: labelled(location, "Zone") || clean(data.zone), pinCode: labelled(location, "Pincode") || clean(data.pincode),
    },
    society: {
      security: labelled(society, "Security"), waterSupply: labelled(society, "Water Supply"), powerBackup: labelled(society, "Power Backup"),
      lift: labelled(society, "Lift"), visitorParking: labelled(society, "Visitor Parking"), maintenanceStaff: labelled(society, "Maintenance Staff"),
    },
    facilities,
    amenities: facilities.map((row) => row.name),
    nearbyDetails,
    projectNarrative,
    masterPlan,
    faqs,
    reraRegistered: reraPhases.length > 0 || /yes|true/i.test(labelled(exactSection(source, "RERA"), "RERA Registered")),
    reraNumber: reraPhases[0]?.reraNumber || "",
    reraPhases,
    image: "",
    images: [],
    heroImages: [],
  };
  if (type !== "Apartment") warnings.push(`Package declares ${type}; direct batch parser currently preserves its common fields for manual type-specific review.`);
  if (!payload.locality.pinCode) warnings.push("PIN code is blank in the source package.");
  configurations.forEach((row) => {
    const missing = [!row.carpetArea && "carpet area", !row.bathrooms && "bathrooms", row.balconies === undefined && "balconies"].filter(Boolean);
    if (missing.length) warnings.push(`${row.configuration}: missing ${missing.join(", ")}.`);
  });
  return { payload, warnings: [...new Set(warnings)] };
}

module.exports = { parsePropertyTemplate, exactSections, labelled };
