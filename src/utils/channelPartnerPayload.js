const path = require("path");

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GST = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const MOBILE = /^[6-9][0-9]{9}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN = /^[1-9][0-9]{5}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT = /^[0-9]{6,20}$/;
const BUSINESS_TYPES = new Set(["proprietorship", "partnership", "llp", "private_limited", "individual_consultant", "other"]);
const PARTNER_TYPES = new Set(["company", "individual"]);
const TEAM_STRENGTH = new Set(["0_2", "3_5", "6_10", "10_plus"]);
const SEGMENTS = new Set(["apartments", "villas", "plots", "commercial"]);
const MIME = new Set(["image/jpeg", "image/png", "application/pdf"]);

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const upper = (value, max) => clean(value, max).toUpperCase();
const digits = (value) => clean(value, 30).replace(/\D/g, "");

function documentValue(value, field, errors, required = false) {
  if (!value || typeof value !== "object") {
    if (required) errors.push(`${field} is required`);
    return undefined;
  }
  let url;
  try { url = new URL(clean(value.url, 2000)); } catch { errors.push(`${field} has an invalid upload URL`); return undefined; }
  const allowTestHost = process.env.NODE_ENV === "test" && url.hostname === "cdn.example.com";
  if (!(url.protocol === "https:" && (url.hostname === "res.cloudinary.com" || allowTestHost))) {
    errors.push(`${field} must be uploaded through ClearTitle`);
  }
  const mimeType = clean(value.mimeType, 100).toLowerCase();
  const bytes = Number(value.bytes);
  if (!MIME.has(mimeType)) errors.push(`${field} has an unsupported file type`);
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > 10 * 1024 * 1024) errors.push(`${field} has an invalid file size`);
  return {
    url: url.toString(),
    originalName: path.basename(clean(value.originalName, 180)).replace(/[\u0000-\u001f]/g, ""),
    mimeType,
    bytes,
    uploadedAt: new Date(),
  };
}

function buildChannelPartnerPayload(body) {
  const errors = [];
  const company = body.company || {};
  const contact = body.contact || {};
  const address = body.address || {};
  const business = body.business || {};
  const bank = body.bank || {};
  const documents = body.documents || {};
  const declaration = body.declaration || {};
  const signatory = body.signatory || {};
  const signature = body.signature || {};
  const nowYear = new Date().getFullYear();
  const submittedPartnerType = clean(body.partnerType, 20);
  const partnerType = submittedPartnerType || "company";
  const isIndividual = partnerType === "individual";
  if (!PARTNER_TYPES.has(partnerType)) errors.push("Choose a valid channel partner type");

  const companyName = clean(company.name, 160);
  const businessType = clean(company.businessType, 40);
  const yearEstablished = clean(company.yearEstablished, 4) ? Number(company.yearEstablished) : undefined;
  const panNumber = upper(company.panNumber, 10);
  const gstNumber = upper(company.gstNumber, 15);
  const reraNumber = upper(company.reraNumber, 80);
  const reraApplicable = Boolean(reraNumber);
  if (!companyName) errors.push(isIndividual ? "Partner name is required" : "Company / firm name is required");
  if (!BUSINESS_TYPES.has(businessType)) errors.push("Choose a valid business type");
  if (yearEstablished !== undefined && (!Number.isInteger(yearEstablished) || yearEstablished < 1900 || yearEstablished > nowYear)) errors.push("Enter a valid establishment year");
  if (!PAN.test(panNumber)) errors.push("Enter a valid PAN number");
  if (gstNumber && !GST.test(gstNumber)) errors.push("Enter a valid GST number");

  const mobile = digits(contact.mobile);
  const alternateMobile = digits(contact.alternateMobile);
  const email = clean(contact.email, 180).toLowerCase();
  if (!clean(contact.name, 120)) errors.push("Contact person name is required");
  if (!clean(contact.designation, 100)) errors.push("Contact designation is required");
  if (!MOBILE.test(mobile)) errors.push("Enter a valid 10-digit Indian mobile number");
  if (alternateMobile && (!MOBILE.test(alternateMobile) || alternateMobile === mobile)) errors.push("Enter a different valid alternate mobile number");
  if (!EMAIL.test(email)) errors.push("Enter a valid email address");
  if (!clean(address.line1, 240)) errors.push("Office address is required");
  if (!clean(address.city, 100)) errors.push("City is required");
  if (!clean(address.state, 100)) errors.push("State is required");
  if (!PIN.test(digits(address.pinCode))) errors.push("Enter a valid PIN code");

  const areas = Array.isArray(business.areasOfOperation)
    ? business.areasOfOperation.map((item) => clean(item, 100)).filter(Boolean).slice(0, 20)
    : clean(business.areasOfOperation, 1000).split(",").map((item) => clean(item, 100)).filter(Boolean).slice(0, 20);
  const teamStrength = clean(business.teamStrength, 20);
  const preferredSegments = Array.isArray(business.preferredSegments)
    ? [...new Set(business.preferredSegments.map((item) => clean(item, 30)).filter((item) => SEGMENTS.has(item)))].slice(0, 6)
    : [];
  if (!areas.length) errors.push("Add at least one area of operation");
  if (!clean(business.currentProjects, 1500)) errors.push("Projects currently selling is required");
  if (!isIndividual && !TEAM_STRENGTH.has(teamStrength)) errors.push("Choose a valid team strength");
  if (!preferredSegments.length) errors.push("Choose at least one preferred segment");

  const accountNumber = digits(bank.accountNumber);
  const ifscCode = upper(bank.ifscCode, 11);
  if (!clean(bank.accountHolderName, 160)) errors.push("Account holder name is required");
  if (!clean(bank.bankName, 160)) errors.push("Bank name is required");
  if (!clean(bank.branch, 160)) errors.push("Bank branch is required");
  if (!ACCOUNT.test(accountNumber)) errors.push("Enter a valid bank account number");
  if (!IFSC.test(ifscCode)) errors.push("Enter a valid IFSC code");

  const normalizedDocuments = {
    panCard: documentValue(documents.panCard, "PAN card", errors, true),
    reraCertificate: documentValue(documents.reraCertificate, "RERA certificate", errors, reraApplicable),
    gstCertificate: documentValue(documents.gstCertificate, "GST certificate", errors, Boolean(gstNumber)),
    cancelledCheque: documentValue(documents.cancelledCheque, "Cancelled cheque", errors, true),
    visitingCard: documentValue(documents.visitingCard, "Visiting card", errors),
    ...(!isIndividual ? { companyLogo: documentValue(documents.companyLogo, "Company logo", errors) } : {}),
    signatureUpload: documentValue(documents.signatureUpload, "Signature", errors, true),
  };

  const declarationKeys = ["informationAccurate", "partnerPolicyAccepted", "leadPolicyAccepted", "brokeragePolicyAccepted", "approvalAcknowledged"];
  if (declarationKeys.some((key) => declaration[key] !== true)) errors.push("All declarations and policies must be accepted");
  const signedDate = new Date(signatory.signedDate);
  if (!clean(signatory.name, 120)) errors.push("Authorized signatory name is required");
  if (!clean(signatory.designation, 100)) errors.push("Authorized signatory designation is required");
  if (Number.isNaN(signedDate.getTime()) || signedDate > new Date(Date.now() + 86400000)) errors.push("Enter a valid signature date");
  if (!["drawn", "uploaded"].includes(signature.mode)) errors.push("Choose a valid signature method");

  if (errors.length) return { errors };
  return { errors, accountNumber, payload: {
    partnerType,
    company: { name: companyName, businessType, yearEstablished, panNumber, gstNumber, reraApplicable, reraNumber },
    contact: { name: clean(contact.name, 120), designation: clean(contact.designation, 100), mobile, alternateMobile, email },
    address: { line1: clean(address.line1, 240), line2: clean(address.line2, 240), city: clean(address.city, 100), state: clean(address.state, 100), pinCode: digits(address.pinCode) },
    business: { areasOfOperation: areas, currentProjects: clean(business.currentProjects, 1500), developerAssociations: clean(business.developerAssociations, 1500), ...(!isIndividual ? { teamStrength } : {}), preferredSegments },
    bank: { accountHolderName: clean(bank.accountHolderName, 160), bankName: clean(bank.bankName, 160), branch: clean(bank.branch, 160), ifscCode },
    documents: normalizedDocuments,
    declaration: Object.fromEntries(declarationKeys.map((key) => [key, true])),
    signatory: { name: clean(signatory.name, 120), designation: clean(signatory.designation, 100), signedDate },
    signature: { mode: signature.mode },
  }};
}

module.exports = { buildChannelPartnerPayload };
