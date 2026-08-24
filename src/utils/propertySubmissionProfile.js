const mongoose = require("mongoose");
const PropertyPosterDocument = require("../models/PropertyPosterDocument");

class PropertySubmissionProfileError extends Error {
  constructor(message) {
    super(message);
    this.name = "PropertySubmissionProfileError";
  }
}

const text = (value, max = 160) => String(value || "").trim().slice(0, max);
const requireText = (value, label, max = 160) => {
  const normalized = text(value, max);
  if (!normalized) throw new PropertySubmissionProfileError(`${label} is required`);
  return normalized;
};
const requirePhone = (value) => {
  const phone = String(value || "").replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) throw new PropertySubmissionProfileError("Enter a valid 10-digit Indian contact number");
  return phone;
};

function existingDocumentId(value) {
  return value?.document || value?.documentId || value?.id || null;
}

async function resolveDocument({ incoming, existing, purpose, posterAccount, propertyId, required = true }) {
  const id = incoming?.id || incoming?.documentId || existingDocumentId(existing);
  if (!id) {
    if (required) throw new PropertySubmissionProfileError(`${purpose.replace(/-/g, " ")} document is required`);
    return { reference: undefined, id: null };
  }
  if (!mongoose.isValidObjectId(id)) throw new PropertySubmissionProfileError("A verification document reference is invalid");
  const propertyAccess = propertyId
    ? { $or: [{ property: null }, { property: propertyId }] }
    : { property: null };
  const document = await PropertyPosterDocument.findOne({ _id: id, posterAccount, purpose, ...propertyAccess });
  if (!document) throw new PropertySubmissionProfileError(`Upload the ${purpose.replace(/-/g, " ")} document again`);
  return {
    reference: { document: document._id, purpose, fileName: document.fileName, mimeType: document.mimeType },
    id: document._id,
  };
}

function normalizePan(incoming, existingLast4) {
  const pan = String(incoming || "").trim().toUpperCase();
  if (!pan && existingLast4) return existingLast4;
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
    throw new PropertySubmissionProfileError("Enter a valid PAN, for example ABCDE1234F");
  }
  return pan.slice(-4);
}

async function normalizePropertySubmissionProfile(payload, account, existingProfile, propertyId) {
  const posterType = payload?.posterType;
  if (!["company", "individual"].includes(posterType)) {
    throw new PropertySubmissionProfileError("Choose Company Project or Individual Property");
  }
  if (payload?.consentAccepted !== true && !existingProfile?.consentAcceptedAt) {
    throw new PropertySubmissionProfileError("Accept the submission and document-verification declaration");
  }

  const documentIds = [];
  const common = {
    posterType,
    verifiedEmail: account.email,
    consentAcceptedAt: existingProfile?.consentAcceptedAt || new Date(),
  };

  if (posterType === "company") {
    const source = payload.company || {};
    const previous = existingProfile?.company || {};
    const panDocument = await resolveDocument({ incoming: source.panDocument, existing: previous.panDocument, purpose: "company-pan", posterAccount: account._id, propertyId });
    const reraApplicable = source.reraApplicable === true;
    const reraDocument = reraApplicable
      ? await resolveDocument({ incoming: source.reraDocument, existing: previous.reraDocument, purpose: "company-rera", posterAccount: account._id, propertyId })
      : { reference: undefined, id: null };
    const registrationDocument = await resolveDocument({ incoming: source.registrationDocument, existing: previous.registrationDocument, purpose: "company-registration", posterAccount: account._id, propertyId, required: false });
    [panDocument.id, reraDocument.id, registrationDocument.id].filter(Boolean).forEach((id) => documentIds.push(id));
    return {
      profile: {
        ...common,
        company: {
          companyName: requireText(source.companyName, "Company name"),
          builderName: text(source.builderName),
          contactPersonName: requireText(source.contactPersonName, "Authorized contact person"),
          designation: text(source.designation, 100),
          phone: requirePhone(source.phone),
          reraApplicable,
          reraNumber: reraApplicable ? requireText(source.reraNumber, "Company RERA number", 80) : "",
          panLast4: normalizePan(source.panNumber, previous.panLast4),
          panDocument: panDocument.reference,
          reraDocument: reraDocument.reference,
          registrationDocument: registrationDocument.reference,
        },
        individual: undefined,
      },
      documentIds,
      displayName: requireText(source.contactPersonName, "Authorized contact person"),
      phone: requirePhone(source.phone),
    };
  }

  const source = payload.individual || {};
  const previous = existingProfile?.individual || {};
  const aadhaarLast4 = String(source.aadhaarLast4 || previous.aadhaarLast4 || "").replace(/\D/g, "").slice(-4);
  if (!/^\d{4}$/.test(aadhaarLast4)) throw new PropertySubmissionProfileError("Enter only the last four digits of Aadhaar");
  const panDocument = await resolveDocument({ incoming: source.panDocument, existing: previous.panDocument, purpose: "individual-pan", posterAccount: account._id, propertyId });
  const aadhaarDocument = await resolveDocument({ incoming: source.aadhaarDocument, existing: previous.aadhaarDocument, purpose: "individual-aadhaar", posterAccount: account._id, propertyId });
  const ownershipDocument = await resolveDocument({ incoming: source.ownershipDocument, existing: previous.ownershipDocument, purpose: "individual-ownership", posterAccount: account._id, propertyId });
  [panDocument.id, aadhaarDocument.id, ownershipDocument.id].forEach((id) => documentIds.push(id));
  return {
    profile: {
      ...common,
      company: undefined,
      individual: {
        ownerName: requireText(source.ownerName, "Owner name"),
        phone: requirePhone(source.phone),
        panLast4: normalizePan(source.panNumber, previous.panLast4),
        aadhaarLast4,
        panDocument: panDocument.reference,
        aadhaarDocument: aadhaarDocument.reference,
        ownershipDocument: ownershipDocument.reference,
      },
    },
    documentIds,
    displayName: requireText(source.ownerName, "Owner name"),
    phone: requirePhone(source.phone),
  };
}

module.exports = { normalizePropertySubmissionProfile, PropertySubmissionProfileError };
