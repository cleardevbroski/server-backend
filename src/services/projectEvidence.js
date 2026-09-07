const crypto = require("crypto");
const DocumentExtraction = require("../models/DocumentExtraction");

function text(value) { return String(value ?? "").trim(); }
function contentHash(value) { return crypto.createHash("sha256").update(text(value)).digest("hex"); }

function add(evidence, id, content, source) {
  const value = text(content);
  if (value) evidence.push({ id, content: value.slice(0, 6000), contentHash: contentHash(value.slice(0, 6000)), ...source });
}

async function buildProjectEvidence(property) {
  const evidence = [];
  add(evidence, "property-basics", [property.title, property.propertyType, property.builder, property.description].filter(Boolean).join(" · "), { type: "property_database", label: "Project basics" });
  add(evidence, "project-price", property.price, { type: "property_database", label: "Project price", updatedAt: property.priceUpdatedAt || property.updatedAt });
  const configurations = property.propertyType === "Villa" ? property.villaDetails?.configurationDetails : property.configurationDetails;
  (configurations || []).forEach((row, index) => add(evidence, `configuration-${index + 1}`, [row.configuration || row.bhk, row.price, row.builtUpArea || row.superBuiltUpArea || row.superArea, row.carpetArea, row.bedrooms != null ? `${row.bedrooms} bedrooms` : "", row.bathrooms != null ? `${row.bathrooms} bathrooms` : "", row.balconies != null ? `${row.balconies} balconies` : ""].filter(Boolean).join(" · "), { type: "property_database", label: `Configuration ${index + 1}` }));
  add(evidence, "possession", [property.possessionDetails?.status, property.possessionDetails?.expectedCompletionDate, property.possessionDetails?.launchDate, property.possession].filter(Boolean).join(" · "), { type: "property_database", label: "Possession details" });
  add(evidence, "location", [property.locality?.address, property.locality?.landmark, property.locality?.city, property.locality?.pinCode, property.locationVerification?.status === "admin_verified" ? "Verified project coordinates" : ""].filter(Boolean).join(" · "), { type: "property_database", label: "Project location" });
  Object.entries(property.nearbyDetails || {}).forEach(([category, group]) => (group?.places || []).forEach((place, index) => add(evidence, `nearby-${category}-${index + 1}`, [place.name, place.distance, place.address, place.landmark].filter(Boolean).join(" · "), { type: "property_database", label: `${category} near the project` })));
  add(evidence, "amenities", [...(property.amenities || []), ...(property.facilities || []).map((item) => [item.name, item.description, item.status].filter(Boolean).join(" — "))].join("; "), { type: "property_database", label: "Project amenities" });
  add(evidence, "developer", property.developerDescription || property.builder, { type: "property_database", label: "Developer information" });
  const narrative = property.projectNarrative || {};
  (narrative.introduction || []).forEach((paragraph, index) => add(evidence, `introduction-${index + 1}`, paragraph, { type: "property_database", label: "Project introduction" }));
  (narrative.usps || []).forEach((value, index) => add(evidence, `usp-${index + 1}`, value, { type: "property_database", label: "Project USP" }));
  (narrative.investmentReasons || narrative.whyInvest || []).forEach((value, index) => add(evidence, `why-invest-${index + 1}`, value, { type: "property_database", label: "Why invest" }));
  (narrative.locationAdvantage || narrative.locationAdvantages || []).forEach((value, index) => add(evidence, `location-advantage-${index + 1}`, value, { type: "property_database", label: "Location advantage" }));
  (narrative.keyDetails || []).forEach((row, index) => add(evidence, `key-detail-${index + 1}`, `${row.label}: ${row.value}`, { type: "property_database", label: row.label || "Project key detail" }));
  (narrative.featureGroups || []).forEach((group, index) => add(evidence, `feature-group-${index + 1}`, [group.title, ...(group.items || [])].join(" · "), { type: "property_database", label: group.title || "Project feature group" }));
  if (property.masterPlan) {
    add(evidence, "master-plan", [property.masterPlan.title, property.masterPlan.summary].filter(Boolean).join(" · "), { type: "property_database", label: property.masterPlan.title || "Master plan" });
    (property.masterPlan.sections || []).forEach((section, index) => add(evidence, `master-plan-section-${index + 1}`, [section.heading, section.body].filter(Boolean).join(" · "), { type: "property_database", label: section.heading || "Master-plan detail" }));
  }
  (property.reraPhases || []).forEach((phase, phaseIndex) => {
    const phaseLabel = phase.name || `Phase ${phaseIndex + 1}`;
    add(evidence, `rera-phase-${phaseIndex + 1}`, [phaseLabel, phase.reraNumber, phase.officialDetails?.registrationStatus, phase.officialDetails?.approvalDate, phase.officialDetails?.registeredCompletionDate, phase.officialDetails?.promoterName, phase.officialDetails?.registeredAddress].filter(Boolean).join(" · "), { type: "rera_record", label: `${phaseLabel} RERA record`, phase: phaseLabel });
    [...(phase.reraDocuments || []), ...(phase.projectDocuments || [])].forEach((document, documentIndex) => add(evidence, `document-${phaseIndex + 1}-${documentIndex + 1}`, `${document.label} (${document.fileName})`, { type: "uploaded_document", label: document.label, phase: phaseLabel, uploadedAt: document.uploadedAt }));
  });
  (property.projectDownloads || []).forEach((document, index) => add(evidence, `project-download-${index + 1}`, `${document.label} (${document.fileName})`, { type: "uploaded_document", label: document.label }));
  (property.faqs || []).forEach((faq, index) => add(evidence, `faq-${index + 1}`, `${faq.question} ${faq.answer}`, { type: "property_database", label: "Project FAQ" }));

  if (property._id) {
    const approvedDocuments = await DocumentExtraction.find({ property: property._id, status: "approved" }).lean();
    approvedDocuments.forEach((document) => (document.pages || []).forEach((page) => {
      const pageText = text(page.reviewedText || page.originalText);
      add(evidence, `extraction-${document._id}-page-${page.pageNumber}`, pageText, {
        type: "uploaded_document_text",
        label: document.label,
        phase: document.phaseName || "",
        pageNumber: page.pageNumber,
        documentExtraction: document._id,
        extractionMethod: page.method,
      });
    }));
  }
  return evidence;
}

module.exports = { buildProjectEvidence, contentHash };
