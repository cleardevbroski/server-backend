const express = require("express");
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const { crmStaffAuth, requireCrmPermission } = require("../middleware/crmStaffAuth");
const ChannelPartner = require("../models/ChannelPartner");
const CRMStaffAccount = require("../models/CRMStaffAccount");
const CPProspect = require("../models/CPProspect");
const CPProspectImportBatch = require("../models/CPProspectImportBatch");
const CPProspectInteraction = require("../models/CPProspectInteraction");
const CPProspectFollowUp = require("../models/CPProspectFollowUp");
const CPCRMMessageTemplate = require("../models/CPCRMMessageTemplate");
const { encryptSensitive, hashLookup } = require("../utils/channelPartnerCrypto");

const router = express.Router();
const clean = (value, max = 2000) => String(value ?? "").trim().slice(0, max);
const digits = (value) => clean(value, 40).replace(/\D/g, "");
const upper = (value, max) => clean(value, max).toUpperCase();
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MOBILE = /^[6-9][0-9]{9}$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const ACCOUNT = /^[0-9]{6,20}$/;
const PROPERTY_TYPES = new Set(CPProspect.PROPERTY_TYPES);
const STATUSES = new Set(CPProspect.VERIFICATION_STATUSES);
const PROSPECT_TYPES = new Set(["channel_partner", "broker"]);
const BROKER_CALL_OUTCOMES = new Set(CPProspect.BROKER_CALL_OUTCOMES.filter(Boolean));
const BROKER_PROJECT_INTERESTS = new Set(CPProspect.BROKER_PROJECT_INTERESTS.filter(Boolean));
const WHATSAPP_OUTCOMES = new Set(["sent", "not_sent"]);

function normalizePhone(value) {
  let valueDigits = digits(value);
  if (valueDigits.length === 12 && valueDigits.startsWith("91")) valueDigits = valueDigits.slice(2);
  if (valueDigits.length === 11 && valueDigits.startsWith("0")) valueDigits = valueDigits.slice(1);
  return valueDigits;
}

function internationalPhone(value) {
  let valueDigits = digits(value);
  if (valueDigits.length === 11 && valueDigits.startsWith("0")) valueDigits = valueDigits.slice(1);
  if (valueDigits.length === 10) valueDigits = `91${valueDigits}`;
  return valueDigits;
}

function normalizedProspectType(value) {
  return PROSPECT_TYPES.has(value) ? value : "channel_partner";
}

function mobileHashFor(mobile, prospectType) {
  const purpose = normalizedProspectType(prospectType) === "broker" ? "broker-prospect-mobile" : "cp-prospect-mobile";
  return hashLookup(mobile, purpose);
}

function list(value, maxItems = 20) {
  const items = Array.isArray(value) ? value : clean(value, 2000).split(/[,;|]/);
  return [...new Set(items.map((item) => clean(item, 100)).filter(Boolean))].slice(0, maxItems);
}

function normalizedSegments(value) {
  const aliases = { apartment: "apartments", villa: "villas", plot: "plots", rental: "rentals" };
  return list(value, 10).map((item) => aliases[item.toLowerCase()] || item.toLowerCase()).filter((item) => PROPERTY_TYPES.has(item));
}

function publicEmployee(employee) {
  if (!employee || typeof employee !== "object") return null;
  return { id: String(employee._id), employeeId: employee.employeeId, name: employee.name, isActive: employee.isActive };
}

function maskedPan(last4) {
  return last4 ? `******${last4}` : "";
}

function maskedAccount(last4) {
  return last4 ? `XXXXXXXX${last4}` : "";
}

function completionFor(prospect) {
  const values = [
    prospect.partnerType,
    prospect.company?.name,
    prospect.company?.businessType,
    prospect.company?.panNumberLast4,
    prospect.contact?.name,
    prospect.contact?.designation,
    prospect.contact?.mobile,
    prospect.contact?.email,
    prospect.address?.line1,
    prospect.address?.city,
    prospect.address?.state,
    prospect.address?.pinCode,
    prospect.business?.areasOfOperation?.length,
    prospect.business?.currentProjects,
    prospect.business?.preferredSegments?.length,
    prospect.bank?.accountHolderName,
    prospect.bank?.bankName,
    prospect.bank?.accountNumberLast4,
    prospect.bank?.ifscCode,
  ];
  return Math.round((values.filter(Boolean).length / values.length) * 100);
}

function presentProspect(prospect) {
  const employee = prospect.assignedEmployeeId && typeof prospect.assignedEmployeeId === "object" ? publicEmployee(prospect.assignedEmployeeId) : null;
  const batch = prospect.importBatchId && typeof prospect.importBatchId === "object"
    ? { id: String(prospect.importBatchId._id), name: prospect.importBatchId.name, originalFileName: prospect.importBatchId.originalFileName }
    : null;
  const existingPartner = prospect.existingPartnerId && typeof prospect.existingPartnerId === "object"
    ? { id: String(prospect.existingPartnerId._id), applicationNumber: prospect.existingPartnerId.applicationNumber, companyName: prospect.existingPartnerId.company?.name || "" }
    : null;
  return {
    id: String(prospect._id), prospectType: normalizedProspectType(prospect.prospectType), importBatchId: String(prospect.importBatchId?._id || prospect.importBatchId), batch,
    sourceRowNumber: prospect.sourceRowNumber, existingPartner,
    assignedEmployeeId: prospect.assignedEmployeeId ? String(prospect.assignedEmployeeId._id || prospect.assignedEmployeeId) : "",
    assignedEmployee: employee, assignedAt: prospect.assignedAt,
    verificationStatus: prospect.verificationStatus, verifiedAt: prospect.verifiedAt,
    lastContactedAt: prospect.lastContactedAt, nextFollowUpAt: prospect.nextFollowUpAt,
    callAttempts: prospect.callAttempts || 0, whatsappOpened: prospect.whatsappOpened || 0,
    whatsappSent: prospect.whatsappSent || 0, whatsappUpdatedAt: prospect.whatsappUpdatedAt || null,
    profileCompletion: prospect.profileCompletion || 0,
    broker: {
      lastCallOutcome: prospect.broker?.lastCallOutcome || "",
      projectInterest: prospect.broker?.projectInterest || "",
      followUpAgenda: prospect.broker?.followUpAgenda || "",
    },
    partnerType: prospect.partnerType || "",
    company: {
      name: prospect.company?.name || "", businessType: prospect.company?.businessType || "",
      yearEstablished: prospect.company?.yearEstablished || "", panMasked: maskedPan(prospect.company?.panNumberLast4),
      gstNumber: prospect.company?.gstNumber || "", reraNumber: prospect.company?.reraNumber || "",
    },
    contact: { ...prospect.contact, mobileHash: undefined },
    address: prospect.address || {}, business: prospect.business || {},
    bank: {
      accountHolderName: prospect.bank?.accountHolderName || "", bankName: prospect.bank?.bankName || "",
      branch: prospect.bank?.branch || "", accountNumberMasked: maskedAccount(prospect.bank?.accountNumberLast4),
      ifscCode: prospect.bank?.ifscCode || "",
    },
    signatory: prospect.signatory || {}, createdAt: prospect.createdAt, updatedAt: prospect.updatedAt,
  };
}

function populateProspects(query) {
  return query
    .populate("assignedEmployeeId", "employeeId name isActive")
    .populate("importBatchId", "name originalFileName")
    .populate("existingPartnerId", "applicationNumber company.name");
}

function sanitizeOriginal(row) {
  const hidden = /pan|account|ifsc|bank/i;
  return Object.fromEntries(Object.entries(row || {}).filter(([key]) => !hidden.test(key)).map(([key, value]) => [clean(key, 100), clean(value, 1000)]));
}

function prospectFromRow(row, batchId, sourceRowNumber, existingPartnerId = null, prospectType = "channel_partner") {
  const mobile = normalizePhone(row.mobile);
  const alternateMobile = normalizePhone(row.alternateMobile);
  const panNumber = upper(row.panNumber, 10);
  const accountNumber = digits(row.accountNumber);
  const yearEstablished = Number(row.yearEstablished);
  const signedDate = row.signedDate ? new Date(row.signedDate) : null;
  const prospect = {
    prospectType: normalizedProspectType(prospectType), importBatchId: batchId, sourceRowNumber, originalData: sanitizeOriginal(row), existingPartnerId,
    partnerType: ["company", "individual"].includes(clean(row.partnerType, 20).toLowerCase()) ? clean(row.partnerType, 20).toLowerCase() : "",
    company: {
      name: clean(row.companyName || row.contactName, 160), businessType: clean(row.businessType, 40).toLowerCase(),
      ...(Number.isInteger(yearEstablished) && yearEstablished >= 1900 && yearEstablished <= new Date().getFullYear() ? { yearEstablished } : {}),
      panNumberEncrypted: PAN.test(panNumber) ? encryptSensitive(panNumber) : "",
      panNumberHash: PAN.test(panNumber) ? hashLookup(panNumber, "cp-prospect-pan") : "",
      panNumberLast4: PAN.test(panNumber) ? panNumber.slice(-4) : "",
      gstNumber: upper(row.gstNumber, 15), reraNumber: upper(row.reraNumber, 80),
    },
    contact: {
      name: clean(row.contactName || row.companyName, 120), designation: clean(row.designation, 100), mobile,
      mobileHash: mobileHashFor(mobile, prospectType), alternateMobile: MOBILE.test(alternateMobile) && alternateMobile !== mobile ? alternateMobile : "",
      email: clean(row.email, 254).toLowerCase(),
    },
    address: {
      line1: clean(row.addressLine1, 240), line2: clean(row.addressLine2, 240), city: clean(row.city, 100),
      state: clean(row.state, 100), pinCode: digits(row.pinCode).slice(0, 6),
    },
    business: {
      areasOfOperation: list(row.areasOfOperation), currentProjects: clean(row.currentProjects, 1500),
      developerAssociations: clean(row.developerAssociations, 1500), teamStrength: clean(row.teamStrength, 20),
      preferredSegments: normalizedSegments(row.preferredSegments),
    },
    bank: {
      accountHolderName: clean(row.accountHolderName, 160), bankName: clean(row.bankName, 160), branch: clean(row.branch, 160),
      accountNumberEncrypted: ACCOUNT.test(accountNumber) ? encryptSensitive(accountNumber) : "",
      accountNumberLast4: ACCOUNT.test(accountNumber) ? accountNumber.slice(-4) : "", ifscCode: upper(row.ifscCode, 11),
    },
    signatory: {
      name: clean(row.signatoryName, 120), designation: clean(row.signatoryDesignation, 100),
      signedDate: signedDate && !Number.isNaN(signedDate.getTime()) ? signedDate : null,
    },
  };
  prospect.profileCompletion = completionFor(prospect);
  return prospect;
}

function prospectFilter(query, employeeId) {
  const filter = employeeId ? { assignedEmployeeId: employeeId } : {};
  if (query.prospectType && PROSPECT_TYPES.has(query.prospectType)) filter.prospectType = query.prospectType;
  if (query.batchId) filter.importBatchId = query.batchId;
  if (query.employeeId === "unassigned") filter.assignedEmployeeId = null;
  else if (!employeeId && query.employeeId) filter.assignedEmployeeId = query.employeeId;
  if (query.status && STATUSES.has(query.status)) filter.verificationStatus = query.status;
  if (query.state) filter["address.state"] = new RegExp(`^${escapeRegex(clean(query.state, 100))}$`, "i");
  if (query.city) filter["address.city"] = new RegExp(`^${escapeRegex(clean(query.city, 100))}$`, "i");
  if (query.area) filter["business.areasOfOperation"] = new RegExp(`^${escapeRegex(clean(query.area, 100))}$`, "i");
  if (query.propertyType && PROPERTY_TYPES.has(query.propertyType)) filter["business.preferredSegments"] = query.propertyType;
  if (query.due === "overdue") filter.nextFollowUpAt = { $lt: new Date() };
  if (query.search) {
    const search = new RegExp(escapeRegex(clean(query.search, 120)), "i");
    filter.$or = [
      { "company.name": search }, { "contact.name": search }, { "contact.mobile": search }, { "contact.whatsappMobile": search },
      { "contact.email": search }, { "address.city": search }, { "business.areasOfOperation": search },
    ];
  }
  return filter;
}

async function prospectMetrics(filter = {}) {
  const now = new Date();
  const employeeFilter = filter.assignedEmployeeId;
  const hasSpecificEmployee = Boolean(employeeFilter) && !(typeof employeeFilter === "object" && Object.keys(employeeFilter).some((key) => key.startsWith("$")));
  const assignedFilter = hasSpecificEmployee ? filter : { ...filter, assignedEmployeeId: { $ne: null } };
  const [total, assigned, pending, active, inactive, callback, unreachable, completed, overdue, interested, notInterested, whatsappOpened, whatsappSent] = await Promise.all([
    CPProspect.countDocuments(filter),
    CPProspect.countDocuments(assignedFilter),
    CPProspect.countDocuments({ ...filter, verificationStatus: "pending" }),
    CPProspect.countDocuments({ ...filter, verificationStatus: "active" }),
    CPProspect.countDocuments({ ...filter, verificationStatus: "inactive" }),
    CPProspect.countDocuments({ ...filter, verificationStatus: "callback_requested" }),
    CPProspect.countDocuments({ ...filter, verificationStatus: { $in: ["no_answer", "busy"] } }),
    CPProspect.countDocuments({ ...filter, verificationStatus: { $nin: ["pending", "callback_requested"] } }),
    CPProspect.countDocuments({ ...filter, nextFollowUpAt: { $lt: now }, verificationStatus: "callback_requested" }),
    CPProspect.countDocuments({ ...filter, "broker.projectInterest": "interested" }),
    CPProspect.countDocuments({ ...filter, "broker.projectInterest": "not_interested" }),
    CPProspect.countDocuments({ ...filter, whatsappOpened: { $gt: 0 } }),
    CPProspect.countDocuments({ ...filter, whatsappSent: { $gt: 0 } }),
  ]);
  return { total, assigned, unassigned: total - assigned, pending, active, inactive, callback, unreachable, completed, overdue, interested, notInterested, whatsappOpened, whatsappSent };
}

async function prospectDetail(prospect) {
  const audience = prospect.prospectType === "broker" ? "broker" : "imported_cp";
  const [interactions, followUps, templates] = await Promise.all([
    CPProspectInteraction.find({ prospectId: prospect._id }).sort({ createdAt: -1 }).limit(100).populate("employeeId", "employeeId name").lean(),
    CPProspectFollowUp.find({ prospectId: prospect._id }).sort({ scheduledAt: -1 }).limit(50).populate("employeeId", "employeeId name").lean(),
    CPCRMMessageTemplate.find({ isActive: true, $or: [{ audience: { $in: ["all", audience] } }, { audience: { $exists: false } }] }).sort({ kind: 1, createdAt: -1 }).lean(),
  ]);
  const presentActivity = (item) => ({ ...item, id: String(item._id), employee: item.employeeId ? publicEmployee(item.employeeId) : null });
  return {
    prospect: presentProspect(prospect), interactions: interactions.map(presentActivity), followUps: followUps.map(presentActivity),
    templates: templates.map((item) => ({ ...item, id: String(item._id) })),
  };
}

async function ownedProspect(req, res) {
  const prospect = await populateProspects(CPProspect.findOne({ _id: req.params.id, assignedEmployeeId: req.crmStaff._id }));
  if (!prospect) res.status(404).json({ error: "This imported contact is not assigned to you." });
  return prospect;
}

router.get("/admin/imports", auth, adminOnly, async (req, res) => {
  try {
    const filter = req.query.prospectType && PROSPECT_TYPES.has(req.query.prospectType) ? { prospectType: req.query.prospectType } : {};
    const batches = await CPProspectImportBatch.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    return res.json({ batches: batches.map((batch) => ({ ...batch, id: String(batch._id) })) });
  } catch { return res.status(500).json({ error: "Unable to load import batches." }); }
});

router.post("/admin/imports", auth, adminOnly, async (req, res) => {
  try {
    const name = clean(req.body.name, 160);
    const originalFileName = clean(req.body.originalFileName, 240);
    const prospectType = normalizedProspectType(req.body.prospectType);
    const totalRows = Number(req.body.totalRows);
    if (!name || !originalFileName || !Number.isInteger(totalRows) || totalRows < 1 || totalRows > 100000) {
      return res.status(400).json({ error: "Enter a batch name and a valid file containing no more than 100,000 rows." });
    }
    const batch = await CPProspectImportBatch.create({ prospectType, name, originalFileName, totalRows, mapping: req.body.mapping || {}, uploadedBy: req.user._id });
    return res.status(201).json({ batch: { ...batch.toObject(), id: String(batch._id) } });
  } catch { return res.status(500).json({ error: "Unable to begin the import." }); }
});

router.post("/admin/imports/:id/rows", auth, adminOnly, async (req, res) => {
  try {
    const batch = await CPProspectImportBatch.findById(req.params.id);
    if (!batch || batch.status !== "importing") return res.status(404).json({ error: "Active import batch not found." });
    const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 500) : [];
    const startRow = Number(req.body.startRow);
    if (!rows.length || !Number.isInteger(startRow) || startRow < 2) return res.status(400).json({ error: "Upload a valid chunk of up to 500 rows." });

    const validRows = [];
    const errors = [];
    rows.forEach((row, index) => {
      const mobile = normalizePhone(row?.mobile);
      if (!MOBILE.test(mobile)) errors.push({ rowNumber: startRow + index, message: "Missing or invalid Indian mobile number." });
      else validRows.push({ row: { ...row, mobile }, sourceRowNumber: startRow + index, mobile });
    });

    const phones = [...new Set(validRows.map((item) => item.mobile))];
    const [existingProspects, registeredPartners] = await Promise.all([
      CPProspect.find({ prospectType: batch.prospectType, "contact.mobileHash": { $in: phones.map((phone) => mobileHashFor(phone, batch.prospectType)) } }).select("+contact.mobileHash").lean(),
      ChannelPartner.find({ "contact.mobile": { $in: phones } }).select("contact.mobile applicationNumber").lean(),
    ]);
    const prospectHashes = new Set(existingProspects.map((item) => item.contact.mobileHash));
    const registeredByPhone = new Map(registeredPartners.map((item) => [item.contact.mobile, item._id]));
    const seenInChunk = new Set();
    const insertRows = [];
    let duplicates = 0;
    let matchedRegistered = 0;
    for (const item of validRows) {
      const mobileHash = mobileHashFor(item.mobile, batch.prospectType);
      if (prospectHashes.has(mobileHash) || seenInChunk.has(mobileHash)) { duplicates += 1; continue; }
      seenInChunk.add(mobileHash);
      const existingPartnerId = registeredByPhone.get(item.mobile) || null;
      if (existingPartnerId) matchedRegistered += 1;
      insertRows.push(prospectFromRow(item.row, batch._id, item.sourceRowNumber, existingPartnerId, batch.prospectType));
    }
    let imported = 0;
    const databaseErrors = [];
    if (insertRows.length) {
      try {
        const inserted = await CPProspect.insertMany(insertRows, { ordered: false });
        imported = inserted.length;
      } catch (error) {
        if (error?.writeErrors) {
          imported = error.insertedDocs?.length || error.result?.insertedCount || 0;
          for (const writeError of error.writeErrors) {
            if (writeError.code === 11000) {
              duplicates += 1;
              continue;
            }
            const failedRow = insertRows[writeError.index];
            databaseErrors.push({
              rowNumber: failedRow?.sourceRowNumber || startRow,
              message: "The database rejected this row. Please verify its imported values.",
            });
          }
        } else throw error;
      }
    }
    batch.processedRows += rows.length;
    batch.importedCount += imported;
    batch.duplicateCount += duplicates;
    batch.invalidCount += errors.length + databaseErrors.length;
    batch.matchedRegisteredCount += matchedRegistered;
    batch.errorSamples = [...batch.errorSamples, ...errors, ...databaseErrors].slice(0, 100);
    await batch.save();
    return res.json({
      processed: rows.length,
      imported,
      duplicates,
      invalid: errors.length + databaseErrors.length,
      matchedRegistered,
      errorSamples: [...errors, ...databaseErrors].slice(0, 20),
    });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Import batch not found." });
    console.error("Import CP prospect rows error:", error);
    return res.status(500).json({ error: "Unable to import this spreadsheet section." });
  }
});

router.post("/admin/imports/:id/complete", auth, adminOnly, async (req, res) => {
  try {
    const batch = await CPProspectImportBatch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: "Import batch not found." });
    batch.status = "completed"; batch.completedAt = new Date(); await batch.save();
    const label = batch.prospectType === "broker" ? "broker contacts" : "CP contacts";
    return res.json({ message: `${batch.importedCount} ${label} imported.`, batch: { ...batch.toObject(), id: String(batch._id) } });
  } catch (error) { return res.status(error.name === "CastError" ? 404 : 500).json({ error: "Unable to complete the import." }); }
});

router.get("/admin/analytics", auth, adminOnly, async (req, res) => {
  try {
    const baseFilter = req.query.prospectType && PROSPECT_TYPES.has(req.query.prospectType) ? { prospectType: req.query.prospectType } : {};
    const [metrics, states, cities, areas, locationRows, employeeRows] = await Promise.all([
      prospectMetrics(baseFilter),
      CPProspect.distinct("address.state", { ...baseFilter, "address.state": { $ne: "" } }),
      CPProspect.distinct("address.city", { ...baseFilter, "address.city": { $ne: "" } }),
      CPProspect.distinct("business.areasOfOperation", { ...baseFilter, "business.areasOfOperation": { $ne: "" } }),
      CPProspect.aggregate([
        { $match: baseFilter },
        { $unwind: { path: "$business.areasOfOperation", preserveNullAndEmptyArrays: true } },
        { $group: {
          _id: { state: "$address.state", city: "$address.city", area: { $ifNull: ["$business.areasOfOperation", "Unspecified"] } },
          total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ["$verificationStatus", "active"] }, 1, 0] } },
          unassigned: { $sum: { $cond: [{ $eq: ["$assignedEmployeeId", null] }, 1, 0] } },
        } },
        { $sort: { "_id.state": 1, "_id.city": 1, "_id.area": 1 } },
        { $limit: 2000 },
      ]),
      CPProspect.aggregate([
        { $match: { ...baseFilter, assignedEmployeeId: { $ne: null } } },
        { $group: { _id: { employeeId: "$assignedEmployeeId", status: "$verificationStatus" }, count: { $sum: 1 } } },
        { $group: { _id: "$_id.employeeId", total: { $sum: "$count" }, statuses: { $push: { k: "$_id.status", v: "$count" } } } },
      ]),
    ]);
    const employees = await CRMStaffAccount.find({ _id: { $in: employeeRows.map((row) => row._id) }, isDeleted: { $ne: true } }).select("employeeId name isActive").lean();
    const employeeMap = new Map(employees.map((employee) => [String(employee._id), employee]));
    return res.json({
      metrics, states: states.sort(), cities: cities.sort(), areas: areas.sort(),
      locations: locationRows.map((row) => ({ state: row._id.state || "Unspecified", city: row._id.city || "Unspecified", area: row._id.area || "Unspecified", total: row.total, active: row.active, unassigned: row.unassigned })),
      employeeProgress: employeeRows.map((row) => ({ employee: publicEmployee(employeeMap.get(String(row._id))), total: row.total, ...Object.fromEntries(row.statuses.map((item) => [item.k, item.v])) })),
    });
  } catch { return res.status(500).json({ error: "Unable to load imported CP analytics." }); }
});

router.get("/admin/prospects", auth, adminOnly, async (req, res) => {
  try {
    const filter = prospectFilter(req.query);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const [prospects, total] = await Promise.all([
      populateProspects(CPProspect.find(filter).sort({ importBatchId: 1, sourceRowNumber: 1 }).skip((page - 1) * limit).limit(limit)),
      CPProspect.countDocuments(filter),
    ]);
    return res.json({ prospects: prospects.map(presentProspect), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { return res.status(error.name === "CastError" ? 400 : 500).json({ error: "Unable to load imported CP contacts." }); }
});

router.get("/admin/prospects/export", auth, adminOnly, async (req, res) => {
  try {
    const prospects = await populateProspects(CPProspect.find(prospectFilter(req.query)).sort({ createdAt: 1 }).limit(50000));
    const header = ["Company", "Contact", "Mobile", "WhatsApp Mobile", "Email", "Status", "Broker Call Result", "Project Interest", "Follow-up Agenda", "City", "State", "Areas", "Property Types", "Employee", "Completion", "WhatsApp Opened", "WhatsApp Sent", "PAN", "Account", "Next Follow-up"];
    const csvValue = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = prospects.map((item) => {
      const value = presentProspect(item);
      return [value.company.name, value.contact.name, value.contact.mobile, value.contact.whatsappMobile || value.contact.mobile, value.contact.email, value.verificationStatus, value.broker.lastCallOutcome, value.broker.projectInterest, value.broker.followUpAgenda, value.address.city, value.address.state, value.business.areasOfOperation.join("; "), value.business.preferredSegments.join("; "), value.assignedEmployee?.name || "", value.profileCompletion, value.whatsappOpened, value.whatsappSent, value.company.panMasked, value.bank.accountNumberMasked, value.nextFollowUpAt || ""].map(csvValue).join(",");
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="verified-cp-contacts-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(`\uFEFF${header.map(csvValue).join(",")}\n${rows.join("\n")}`);
  } catch { return res.status(500).json({ error: "Unable to export imported CP contacts." }); }
});

router.get("/admin/prospects/:id", auth, adminOnly, async (req, res) => {
  try {
    const prospect = await populateProspects(CPProspect.findById(req.params.id));
    if (!prospect) return res.status(404).json({ error: "Imported CP not found." });
    return res.json(await prospectDetail(prospect));
  } catch (error) { return res.status(error.name === "CastError" ? 404 : 500).json({ error: "Unable to load imported CP details." }); }
});

router.patch("/admin/prospects/allocate", auth, adminOnly, async (req, res) => {
  try {
    const employee = await CRMStaffAccount.findOne({ _id: req.body.employeeId, isActive: true, isDeleted: { $ne: true } });
    const prospectIds = Array.isArray(req.body.prospectIds) ? [...new Set(req.body.prospectIds.map(String))] : [];
    const hasSelection = prospectIds.length > 0;
    const rangeFrom = Number(req.body.rangeFrom);
    const rangeTo = Number(req.body.rangeTo);
    const hasRange = Number.isInteger(rangeFrom) || Number.isInteger(rangeTo);
    const count = Number(req.body.count);
    if (!employee) return res.status(404).json({ error: "Active employee not found." });
    if (hasSelection) {
      if (prospectIds.length > 5000 || prospectIds.some((id) => !mongoose.isValidObjectId(id))) {
        return res.status(400).json({ error: "Select between 1 and 5,000 valid contacts." });
      }
    } else if (hasRange) {
      if (!Number.isInteger(rangeFrom) || !Number.isInteger(rangeTo) || rangeFrom < 1 || rangeTo < rangeFrom || rangeTo - rangeFrom + 1 > 5000) {
        return res.status(400).json({ error: "Enter a valid contact range containing no more than 5,000 contacts." });
      }
      if (!req.body.filters?.batchId) return res.status(400).json({ error: "Select an import batch before allocating a contact range." });
    } else if (!Number.isInteger(count) || count < 1 || count > 5000) {
      return res.status(400).json({ error: "Choose between 1 and 5,000 contacts." });
    }

    const filter = hasSelection
      ? { _id: { $in: prospectIds }, prospectType: normalizedProspectType(req.body.filters?.prospectType) }
      : prospectFilter(req.body.filters || {});
    if (!hasSelection && hasRange) filter.sourceRowNumber = { $gte: rangeFrom + 1, $lte: rangeTo + 1 };
    const selectedCount = hasSelection || hasRange ? await CPProspect.countDocuments(filter) : count;
    const unassignedFilter = { ...filter, assignedEmployeeId: null };
    const query = CPProspect.find(unassignedFilter).sort({ sourceRowNumber: 1, createdAt: 1 }).select("_id");
    if (!hasSelection && !hasRange) query.limit(count);
    const prospects = await query.lean();
    if (!prospects.length) return res.status(409).json({ error: "No unassigned contacts match these filters." });
    const update = await CPProspect.updateMany({ _id: { $in: prospects.map((item) => item._id) }, assignedEmployeeId: null }, { $set: { assignedEmployeeId: employee._id, assignedAt: new Date(), assignedBy: req.user._id } });
    const assignedCount = update.modifiedCount;
    const skippedAssignedCount = hasSelection || hasRange ? Math.max(selectedCount - assignedCount, 0) : 0;
    const label = req.body.filters?.prospectType === "broker" ? "broker contact" : "CP contact";
    const skippedMessage = skippedAssignedCount ? ` ${skippedAssignedCount} already assigned contact${skippedAssignedCount === 1 ? " was" : "s were"} skipped.` : "";
    return res.json({
      message: `${assignedCount} imported ${label}${assignedCount === 1 ? "" : "s"} assigned to ${employee.name}.${skippedMessage}`,
      assignedCount,
      selectedCount,
      skippedAssignedCount,
      ...(hasSelection ? { prospectIds } : {}),
      ...(hasRange ? { rangeFrom, rangeTo } : {}),
    });
  } catch (error) { return res.status(error.name === "CastError" ? 400 : 500).json({ error: "Unable to allocate imported CP contacts." }); }
});

router.patch("/admin/prospects/:id/assign", auth, adminOnly, async (req, res) => {
  try {
    const employeeId = req.body.employeeId || null;
    if (employeeId && !await CRMStaffAccount.exists({ _id: employeeId, isActive: true, isDeleted: { $ne: true } })) return res.status(404).json({ error: "Active employee not found." });
    const prospect = await CPProspect.findByIdAndUpdate(req.params.id, { $set: { assignedEmployeeId: employeeId, assignedAt: employeeId ? new Date() : null, assignedBy: employeeId ? req.user._id : null } }, { new: true });
    if (!prospect) return res.status(404).json({ error: "Imported CP not found." });
    return res.json({ message: employeeId ? "Imported contact assigned." : "Imported contact unassigned." });
  } catch (error) { return res.status(error.name === "CastError" ? 404 : 500).json({ error: "Unable to update assignment." }); }
});

router.get("/mine/prospects", crmStaffAuth, requireCrmPermission("cp_crm.view"), async (req, res) => {
  try {
    const filter = prospectFilter(req.query, req.crmStaff._id);
    const metricFilter = { assignedEmployeeId: req.crmStaff._id };
    if (req.query.prospectType && PROSPECT_TYPES.has(req.query.prospectType)) metricFilter.prospectType = req.query.prospectType;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const [prospects, total, metrics] = await Promise.all([
      populateProspects(CPProspect.find(filter).sort({ importBatchId: 1, sourceRowNumber: 1 }).skip((page - 1) * limit).limit(limit)),
      CPProspect.countDocuments(filter), prospectMetrics(metricFilter),
    ]);
    return res.json({ prospects: prospects.map(presentProspect), metrics, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch { return res.status(500).json({ error: "Unable to load your CP verification queue." }); }
});

router.get("/mine/prospects/:id", crmStaffAuth, requireCrmPermission("cp_crm.view"), async (req, res) => {
  try { const prospect = await ownedProspect(req, res); if (!prospect) return; return res.json(await prospectDetail(prospect)); }
  catch (error) { return res.status(error.name === "CastError" ? 404 : 500).json({ error: "Unable to load imported CP details." }); }
});

router.post("/mine/prospects/:id/call-start", crmStaffAuth, requireCrmPermission("cp_crm.contact"), async (req, res) => {
  try {
    const prospect = await ownedProspect(req, res); if (!prospect) return;
    await CPProspectInteraction.create({ prospectId: prospect._id, employeeId: req.crmStaff._id, action: "call_started" });
    prospect.callAttempts += 1; prospect.lastContactedAt = new Date(); await prospect.save();
    return res.status(201).json({ dialNumber: prospect.contact.mobile });
  } catch { return res.status(500).json({ error: "Unable to start the call." }); }
});

function applyProfileUpdates(prospect, input) {
  const changedFields = [];
  const set = (path, value) => {
    const [section, field] = path.split(".");
    if (field) prospect[section][field] = value; else prospect[section] = value;
    changedFields.push(path);
  };
  if (input.partnerType !== undefined && ["", "company", "individual"].includes(input.partnerType)) set("partnerType", input.partnerType);
  const textFields = {
    "company.name": 160, "company.businessType": 40, "company.gstNumber": 15, "company.reraNumber": 80,
    "contact.name": 120, "contact.designation": 100, "contact.alternateMobile": 10, "contact.email": 254,
    "address.line1": 240, "address.line2": 240, "address.city": 100, "address.state": 100, "address.pinCode": 6,
    "business.currentProjects": 1500, "business.developerAssociations": 1500, "business.teamStrength": 20,
    "bank.accountHolderName": 160, "bank.bankName": 160, "bank.branch": 160, "bank.ifscCode": 11,
    "signatory.name": 120, "signatory.designation": 100,
  };
  for (const [path, max] of Object.entries(textFields)) {
    const [section, field] = path.split(".");
    if (input[section]?.[field] !== undefined) {
      let value = clean(input[section][field], max);
      if (["company.gstNumber", "company.reraNumber", "bank.ifscCode"].includes(path)) value = value.toUpperCase();
      if (["contact.alternateMobile", "address.pinCode"].includes(path)) value = digits(value).slice(0, max);
      set(path, value);
    }
  }
  if (input.company?.yearEstablished !== undefined) {
    const year = Number(input.company.yearEstablished);
    if (Number.isInteger(year) && year >= 1900 && year <= new Date().getFullYear()) set("company.yearEstablished", year);
  }
  if (input.business?.areasOfOperation !== undefined) set("business.areasOfOperation", list(input.business.areasOfOperation));
  if (input.business?.preferredSegments !== undefined) set("business.preferredSegments", normalizedSegments(input.business.preferredSegments));
  if (input.contact?.mobile !== undefined) {
    const mobile = normalizePhone(input.contact.mobile);
    if (!MOBILE.test(mobile)) throw Object.assign(new Error("Enter a valid 10-digit Indian mobile number."), { statusCode: 400 });
    if (mobile !== prospect.contact.mobile) {
      prospect.contact.mobile = mobile; prospect.contact.mobileHash = mobileHashFor(mobile, prospect.prospectType); changedFields.push("contact.mobile");
    }
  }
  if (input.company?.panNumber) {
    const pan = upper(input.company.panNumber, 10);
    if (!PAN.test(pan)) throw Object.assign(new Error("Enter a valid PAN number."), { statusCode: 400 });
    prospect.company.panNumberEncrypted = encryptSensitive(pan); prospect.company.panNumberHash = hashLookup(pan, "cp-prospect-pan"); prospect.company.panNumberLast4 = pan.slice(-4); changedFields.push("company.panNumber");
  }
  if (input.bank?.accountNumber) {
    const account = digits(input.bank.accountNumber);
    if (!ACCOUNT.test(account)) throw Object.assign(new Error("Enter a valid bank account number."), { statusCode: 400 });
    prospect.bank.accountNumberEncrypted = encryptSensitive(account); prospect.bank.accountNumberLast4 = account.slice(-4); changedFields.push("bank.accountNumber");
  }
  if (input.signatory?.signedDate !== undefined) {
    const signedDate = input.signatory.signedDate ? new Date(input.signatory.signedDate) : null;
    if (signedDate && Number.isNaN(signedDate.getTime())) throw Object.assign(new Error("Enter a valid signatory date."), { statusCode: 400 });
    prospect.signatory.signedDate = signedDate; changedFields.push("signatory.signedDate");
  }
  prospect.profileCompletion = completionFor(prospect);
  return [...new Set(changedFields)];
}

router.patch("/mine/prospects/:id/profile", crmStaffAuth, requireCrmPermission("cp_crm.contact"), async (req, res) => {
  try {
    const prospect = await ownedProspect(req, res); if (!prospect) return;
    const changedFields = applyProfileUpdates(prospect, req.body || {});
    if (!changedFields.length) return res.status(400).json({ error: "No profile changes were provided." });
    await prospect.save();
    await CPProspectInteraction.create({ prospectId: prospect._id, employeeId: req.crmStaff._id, action: "profile_updated", changedFields });
    const populated = await populateProspects(CPProspect.findById(prospect._id));
    return res.json({ message: "CP information updated.", prospect: presentProspect(populated) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ error: "That mobile number already belongs to another imported contact of this type." });
    return res.status(error.statusCode || (error.name === "ValidationError" ? 400 : 500)).json({ error: error.message || "Unable to update CP information." });
  }
});

router.post("/mine/prospects/:id/verification", crmStaffAuth, requireCrmPermission("cp_crm.contact"), async (req, res) => {
  try {
    const prospect = await ownedProspect(req, res); if (!prospect) return;
    const outcome = clean(req.body.outcome, 60);
    const note = clean(req.body.note, 2000);
    if (!STATUSES.has(outcome) || outcome === "pending") return res.status(400).json({ error: "Choose a valid verification result." });
    if (outcome === "other" && !note) return res.status(400).json({ error: "Enter a note for the Other result." });
    let callbackAt = null;
    if (outcome === "callback_requested") {
      callbackAt = new Date(req.body.callbackAt);
      if (Number.isNaN(callbackAt.getTime()) || callbackAt <= new Date()) return res.status(400).json({ error: "Choose a future callback date and time." });
    }
    const changedFields = req.body.profile ? applyProfileUpdates(prospect, req.body.profile) : [];
    const interaction = await CPProspectInteraction.create({ prospectId: prospect._id, employeeId: req.crmStaff._id, action: "verification_result", outcome, note, callbackAt, changedFields });
    const now = new Date();
    await CPProspectFollowUp.updateMany({ prospectId: prospect._id, employeeId: req.crmStaff._id, status: "pending" }, { $set: { status: "completed", completedAt: now } });
    if (callbackAt) await CPProspectFollowUp.create({ prospectId: prospect._id, employeeId: req.crmStaff._id, sourceInteractionId: interaction._id, scheduledAt: callbackAt, note });
    prospect.verificationStatus = outcome; prospect.verifiedAt = outcome === "callback_requested" ? null : now;
    prospect.lastContactedAt = now; prospect.nextFollowUpAt = callbackAt; await prospect.save();
    return res.status(201).json({ message: callbackAt ? "Verification saved and callback scheduled." : "Verification result saved." });
  } catch (error) { return res.status(error.statusCode || (error.name === "ValidationError" ? 400 : 500)).json({ error: error.message || "Unable to save verification." }); }
});

router.post("/mine/prospects/:id/broker-result", crmStaffAuth, requireCrmPermission("cp_crm.contact"), async (req, res) => {
  try {
    const prospect = await ownedProspect(req, res); if (!prospect) return;
    if (prospect.prospectType !== "broker") return res.status(400).json({ error: "This result is only available for broker contacts." });

    const outcome = clean(req.body.outcome, 60);
    const projectInterest = clean(req.body.projectInterest, 60);
    const followUpAgenda = clean(req.body.followUpAgenda, 2000);
    const note = clean(req.body.note, 2000);
    if (!BROKER_CALL_OUTCOMES.has(outcome)) return res.status(400).json({ error: "Choose a valid broker call result." });
    if (outcome === "answered" && !BROKER_PROJECT_INTERESTS.has(projectInterest)) return res.status(400).json({ error: "Choose whether the broker is interested in this project." });

    let callbackAt = null;
    if (outcome === "callback_requested" || (outcome === "answered" && projectInterest === "interested")) {
      callbackAt = new Date(req.body.callbackAt);
      if (Number.isNaN(callbackAt.getTime()) || callbackAt <= new Date()) return res.status(400).json({ error: "Choose a future follow-up date and time." });
      if (!followUpAgenda) return res.status(400).json({ error: "Enter what should be discussed in the follow-up call." });
    }

    let areasOfOperation = prospect.business?.areasOfOperation || [];
    let preferredSegments = prospect.business?.preferredSegments || [];
    const changedFields = [];
    if (outcome === "answered" && projectInterest === "not_interested") {
      areasOfOperation = list(req.body.areasOfOperation);
      preferredSegments = normalizedSegments(req.body.preferredSegments);
      if (!areasOfOperation.length && !preferredSegments.length) return res.status(400).json({ error: "Enter at least one working area or property type." });
      prospect.business.areasOfOperation = areasOfOperation;
      prospect.business.preferredSegments = preferredSegments;
      changedFields.push("business.areasOfOperation", "business.preferredSegments");
    }

    const interaction = await CPProspectInteraction.create({
      prospectId: prospect._id,
      employeeId: req.crmStaff._id,
      action: "broker_call_result",
      outcome,
      note,
      callbackAt,
      changedFields,
      metadata: { projectInterest: outcome === "answered" ? projectInterest : "", followUpAgenda, areasOfOperation, preferredSegments },
    });
    const now = new Date();
    await CPProspectFollowUp.updateMany({ prospectId: prospect._id, employeeId: req.crmStaff._id, status: "pending" }, { $set: { status: "completed", completedAt: now } });
    if (callbackAt) await CPProspectFollowUp.create({ prospectId: prospect._id, employeeId: req.crmStaff._id, sourceInteractionId: interaction._id, scheduledAt: callbackAt, note: followUpAgenda });

    const status = outcome === "answered"
      ? (projectInterest === "interested" ? "active" : "inactive")
      : outcome;
    prospect.broker.lastCallOutcome = outcome;
    prospect.broker.projectInterest = outcome === "answered" ? projectInterest : "";
    prospect.broker.followUpAgenda = followUpAgenda;
    prospect.verificationStatus = status;
    prospect.verifiedAt = status === "callback_requested" ? null : now;
    prospect.lastContactedAt = now;
    prospect.nextFollowUpAt = callbackAt;
    await prospect.save();
    return res.status(201).json({ message: callbackAt ? "Broker result saved and follow-up scheduled." : "Broker call result saved." });
  } catch (error) {
    return res.status(error.statusCode || (error.name === "ValidationError" ? 400 : 500)).json({ error: error.message || "Unable to save the broker call result." });
  }
});

router.post("/mine/prospects/:id/whatsapp-open", crmStaffAuth, requireCrmPermission("cp_crm.contact"), async (req, res) => {
  try {
    const prospect = await ownedProspect(req, res); if (!prospect) return;
    if (prospect.verificationStatus === "wrong_number" && !prospect.contact.whatsappMobile) return res.status(400).json({ error: "Add a different WhatsApp number before messaging this wrong-number contact." });
    const audience = prospect.prospectType === "broker" ? "broker" : "imported_cp";
    let template = null;
    let messageBody = "";
    if (req.body.templateId) {
      template = await CPCRMMessageTemplate.findOne({ _id: req.body.templateId, isActive: true, $or: [{ audience: { $in: ["all", audience] } }, { audience: { $exists: false } }] });
      if (!template) return res.status(400).json({ error: "Choose an active admin message template." });
      messageBody = clean(req.body.messageBody, 5000);
    } else if (prospect.prospectType === "broker") {
      messageBody = "Hi";
    } else {
      return res.status(400).json({ error: "Choose an active admin message template." });
    }
    if (!messageBody) return res.status(400).json({ error: "The WhatsApp message is empty." });
    const whatsappMobile = prospect.contact.whatsappMobile || prospect.contact.mobile;
    const number = internationalPhone(whatsappMobile);
    if (number.length < 10) return res.status(400).json({ error: "The WhatsApp number is invalid." });
    const interaction = await CPProspectInteraction.create({ prospectId: prospect._id, employeeId: req.crmStaff._id, action: "whatsapp_opened", messageBody, templateId: template?._id || null, metadata: { whatsappMobile, usesAlternateNumber: Boolean(prospect.contact.whatsappMobile) } });
    prospect.whatsappOpened = (prospect.whatsappOpened || 0) + 1;
    await prospect.save();
    return res.status(201).json({ interactionId: String(interaction._id), whatsappUrl: `https://wa.me/${number}?text=${encodeURIComponent(messageBody)}` });
  } catch (error) {
    if (error.name === "CastError") return res.status(400).json({ error: "Choose a valid WhatsApp template." });
    return res.status(500).json({ error: "Unable to open WhatsApp." });
  }
});

router.patch("/mine/prospects/:id/whatsapp-number", crmStaffAuth, requireCrmPermission("cp_crm.contact"), async (req, res) => {
  try {
    const prospect = await ownedProspect(req, res); if (!prospect) return;
    const previousNumber = prospect.contact.whatsappMobile || "";
    const whatsappMobile = req.body.whatsappMobile ? normalizePhone(req.body.whatsappMobile) : "";
    if (whatsappMobile && !MOBILE.test(whatsappMobile)) return res.status(400).json({ error: "Enter a valid 10-digit Indian WhatsApp number." });
    if (whatsappMobile === prospect.contact.mobile) return res.status(400).json({ error: "This is already the primary mobile number. Use the primary number instead." });
    if (whatsappMobile === previousNumber) return res.json({ message: "WhatsApp number is already up to date.", whatsappMobile, whatsappUpdatedAt: prospect.whatsappUpdatedAt });
    const now = new Date();
    prospect.contact.whatsappMobile = whatsappMobile;
    prospect.whatsappUpdatedAt = now;
    prospect.whatsappUpdatedBy = req.crmStaff._id;
    await prospect.save();
    await CPProspectInteraction.create({ prospectId: prospect._id, employeeId: req.crmStaff._id, action: "whatsapp_number_updated", note: whatsappMobile ? `WhatsApp number changed to ${whatsappMobile}.` : `WhatsApp reset to primary number ${prospect.contact.mobile}.`, changedFields: ["contact.whatsappMobile"], metadata: { previousNumber, whatsappMobile, usesPrimaryNumber: !whatsappMobile } });
    return res.json({ message: whatsappMobile ? "WhatsApp number saved." : "WhatsApp reset to the primary mobile number.", whatsappMobile, whatsappUpdatedAt: now });
  } catch (error) {
    return res.status(error.name === "CastError" ? 404 : 500).json({ error: "Unable to update the WhatsApp number." });
  }
});

router.post("/mine/prospects/:id/whatsapp-result", crmStaffAuth, requireCrmPermission("cp_crm.contact"), async (req, res) => {
  try {
    const prospect = await ownedProspect(req, res); if (!prospect) return;
    const outcome = clean(req.body.outcome, 30);
    if (!WHATSAPP_OUTCOMES.has(outcome)) return res.status(400).json({ error: "Choose whether the WhatsApp message was sent." });
    const interactionId = clean(req.body.interactionId, 80);
    const opened = await CPProspectInteraction.exists({ _id: interactionId, prospectId: prospect._id, employeeId: req.crmStaff._id, action: "whatsapp_opened" });
    if (!opened) return res.status(400).json({ error: "The matching WhatsApp action was not found." });
    await CPProspectInteraction.create({ prospectId: prospect._id, employeeId: req.crmStaff._id, action: "whatsapp_result", outcome, note: clean(req.body.note, 2000), metadata: { openedInteractionId: interactionId } });
    if (outcome === "sent") prospect.whatsappSent = (prospect.whatsappSent || 0) + 1;
    await prospect.save();
    return res.status(201).json({ message: "WhatsApp result saved." });
  } catch (error) {
    if (error.name === "CastError") return res.status(400).json({ error: "The matching WhatsApp action is invalid." });
    return res.status(500).json({ error: "Unable to save the WhatsApp result." });
  }
});

router.post("/mine/prospects/:id/notes", crmStaffAuth, requireCrmPermission("cp_crm.contact"), async (req, res) => {
  try {
    const prospect = await ownedProspect(req, res); if (!prospect) return;
    const note = clean(req.body.note, 2000);
    if (!note) return res.status(400).json({ error: "Enter a note." });
    await CPProspectInteraction.create({ prospectId: prospect._id, employeeId: req.crmStaff._id, action: "note", note });
    return res.status(201).json({ message: "Note saved." });
  } catch { return res.status(500).json({ error: "Unable to save note." }); }
});

module.exports = router;
