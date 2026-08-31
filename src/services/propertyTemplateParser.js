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
  const match = clean(value).match(/\b(\d+(?:\.5)?)\s*BHK\b/i);
  return match ? `${Number(match[1])} BHK` : clean(value);
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
  const configurations = configBlocks.map((block) => {
    const rawName = labelled(block, "Configuration Name") || labelled(block, "BHK Configuration") || labelled(block, "BHK");
    return {
      configuration: configurationName(rawName),
      price: labelled(block, "Price"),
      builtUpArea: labelled(block, "Built-up Area"),
      carpetArea: labelled(block, "Carpet Area"),
      superBuiltUpArea: labelled(block, "Super Area"),
      bedrooms: number(labelled(block, "Bedrooms")) || number(rawName),
      bathrooms: number(labelled(block, "Bathrooms")),
      balconies: number(labelled(block, "Balconies")),
      facings: importedFacings(labelled(block, "Facings") || labelled(block, "Facing")),
    };
  }).filter((row) => row.configuration);

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
