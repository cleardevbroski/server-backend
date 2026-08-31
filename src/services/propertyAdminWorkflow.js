const ADMIN_WORKFLOW_STATUSES = new Set(["recheck", "pending", "approved", "published", "rejected"]);

class PropertyWorkflowError extends Error {
  constructor(message, status = 409, readiness) {
    super(message);
    this.name = "PropertyWorkflowError";
    this.status = status;
    this.readiness = readiness;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function propertyConfigurations(property) {
  if (property.propertyType === "Villa") return list(property.villaDetails?.configurationDetails);
  if (property.propertyType === "Plot") return list(property.plotDetails?.plotSizeDetails);
  if (property.propertyType === "PG/Co-living") return list(property.pgDetails?.sharingDetails);
  if (property.propertyType === "Commercial") return property.commercialDetails?.commercialSubtype ? [property.commercialDetails] : [];
  return list(property.configurationDetails);
}

function mediaCount(property) {
  return new Set([
    text(property.image),
    ...list(property.heroImages).map(text),
    ...list(property.images).map(text),
  ].filter(Boolean)).size;
}

function documentCount(property) {
  return list(property.reraPhases).reduce(
    (total, phase) => total + list(phase.reraDocuments).length + list(phase.projectDocuments).length,
    0,
  );
}

function hasProjectCoordinates(property) {
  return Number.isFinite(Number(property?.locality?.latitude)) && Number.isFinite(Number(property?.locality?.longitude));
}

function hasVerifiedProjectLocation(property) {
  if (!hasProjectCoordinates(property)) return false;
  const verification = property.locationVerification;
  return verification?.status === "admin_verified"
    && Math.abs(Number(verification.inputLatitude) - Number(property.locality.latitude)) < 0.0000001
    && Math.abs(Number(verification.inputLongitude) - Number(property.locality.longitude)) < 0.0000001
    && Boolean(verification.verifiedAt && verification.resolvedAddress);
}

function buildPropertyReviewReadiness(property) {
  const source = typeof property?.toObject === "function" ? property.toObject() : property || {};
  const phases = list(source.reraPhases);
  const configurations = propertyConfigurations(source);
  const documents = documentCount(source);
  const photos = mediaCount(source);
  const hasCoordinates = hasProjectCoordinates(source);
  const verifiedLocation = hasVerifiedProjectLocation(source);
  const hasValidRera = !source.reraRegistered || (phases.length > 0 && phases.every((phase) => text(phase.name) && text(phase.reraNumber).length >= 8));
  const checks = [
    { key: "title", label: "Project name", passed: Boolean(text(source.title)), severity: "blocker" },
    { key: "propertyType", label: "Property type", passed: ["Apartment", "Villa", "Plot", "Commercial", "PG/Co-living"].includes(text(source.propertyType)), severity: "blocker" },
    { key: "builder", label: "Builder / developer", passed: Boolean(text(source.builder)), severity: "blocker" },
    { key: "configuration", label: "Type-specific configuration", passed: configurations.length > 0, severity: "blocker" },
    { key: "rera", label: "RERA phase names and numbers", passed: hasValidRera, severity: "blocker" },
    { key: "locationVerification", label: "Project coordinate verification", passed: !hasCoordinates || verifiedLocation, severity: "warning" },
    { key: "description", label: "Property description", passed: text(source.description).length >= 50, severity: "warning" },
    { key: "location", label: "City and address", passed: Boolean(text(source.locality?.city) && text(source.locality?.address)), severity: "warning" },
    { key: "locationCoordinates", label: "Project map coordinates", passed: hasCoordinates, severity: "warning" },
    { key: "price", label: "Property price", passed: Boolean(text(source.price)), severity: "warning" },
    { key: "photos", label: "Property photos", passed: photos > 0, severity: "warning" },
    { key: "documents", label: "RERA / project documents", passed: !source.reraRegistered || documents > 0, severity: "warning" },
    { key: "masterPlan", label: "Master plan", passed: Boolean(text(source.masterPlan?.imageUrl) || list(source.projectDownloads).some((item) => item?.kind === "master-plan")), severity: "warning" },
  ];
  const blockers = checks.filter((check) => !check.passed && check.severity === "blocker").map((check) => check.label);
  const warnings = checks.filter((check) => !check.passed && check.severity === "warning").map((check) => check.label);
  const passed = checks.filter((check) => check.passed).length;
  return {
    score: Math.round((passed / checks.length) * 100),
    canPublish: blockers.length === 0,
    blockers,
    warnings,
    checks,
    configurationCount: configurations.length,
    phaseCount: phases.length,
    documentCount: documents,
    photoCount: photos,
  };
}

const TRANSITIONS = {
  recheck: new Set(["move_to_pending", "publish", "reject"]),
  pending: new Set(["move_to_recheck", "publish", "reject"]),
  approved: new Set(["move_to_pending", "move_to_recheck", "reject"]),
  published: new Set(["move_to_pending", "move_to_recheck", "reject"]),
  rejected: new Set(["move_to_pending", "move_to_recheck"]),
};

function resolveAdminWorkflowTransition(property, action) {
  if (property.submittedBy === "user") {
    throw new PropertyWorkflowError("Public submissions must use the submission review workflow");
  }
  const current = ADMIN_WORKFLOW_STATUSES.has(property.status) ? property.status : property.published === false ? "pending" : "approved";
  if (!TRANSITIONS[current]?.has(action)) {
    throw new PropertyWorkflowError(`Cannot ${String(action).replaceAll("_", " ")} a property currently marked ${current}`);
  }
  const target = action === "publish" ? "approved" : action === "move_to_recheck" ? "recheck" : action === "reject" ? "rejected" : "pending";
  return { current, target };
}

module.exports = {
  PropertyWorkflowError,
  buildPropertyReviewReadiness,
  hasProjectCoordinates,
  hasVerifiedProjectLocation,
  resolveAdminWorkflowTransition,
};
