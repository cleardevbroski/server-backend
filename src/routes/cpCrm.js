const express = require("express");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { body, validationResult } = require("express-validator");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const { crmStaffAuth, requireCrmPermission } = require("../middleware/crmStaffAuth");
const { hashPassword, verifyPassword } = require("../utils/password");
const ChannelPartner = require("../models/ChannelPartner");
const ChannelPartnerClient = require("../models/ChannelPartnerClient");
const CRMStaffAccount = require("../models/CRMStaffAccount");
const CPCRMProfile = require("../models/CPCRMProfile");
const CPCRMInteraction = require("../models/CPCRMInteraction");
const CPCRMFollowUp = require("../models/CPCRMFollowUp");
const CPCRMTask = require("../models/CPCRMTask");
const CPCRMTaskItem = require("../models/CPCRMTaskItem");
const CPCRMMessageTemplate = require("../models/CPCRMMessageTemplate");
const CPProspect = require("../models/CPProspect");
const CPProspectInteraction = require("../models/CPProspectInteraction");
const CPProspectFollowUp = require("../models/CPProspectFollowUp");

const router = express.Router();
const TEMPLATE_AUDIENCES = new Set(["all", "registered_cp", "imported_cp", "broker"]);
const clean = (value, max = 2000) => String(value ?? "").trim().slice(0, max);
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const employeeLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 1000 : 50,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many failed employee login attempts. Try again in 15 minutes." },
});
const CALL_OUTCOMES = new Set(["no_answer", "busy", "connected", "callback_requested", "interested", "has_clients", "needs_project_details", "not_interested", "wrong_number", "do_not_contact", "other"]);
const WHATSAPP_OUTCOMES = new Set(["sent", "not_sent", "failed"]);
const MOBILE = /^[6-9][0-9]{9}$/;
const DEFAULT_PERMISSIONS = ["cp_crm.view", "cp_crm.contact"];
const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function indiaDayBounds(now = new Date()) {
  const indiaNow = new Date(now.getTime() + INDIA_OFFSET_MS);
  const indiaMidnightAsUtc = Date.UTC(indiaNow.getUTCFullYear(), indiaNow.getUTCMonth(), indiaNow.getUTCDate());
  const start = new Date(indiaMidnightAsUtc - INDIA_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1) };
}

function validationError(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({ error: errors.array()[0].msg });
    return true;
  }
  return false;
}

function publicStaff(staff) {
  return {
    id: String(staff._id), employeeId: staff.employeeId, name: staff.name, phone: staff.phone,
    email: staff.email, role: staff.role, permissions: staff.permissions || [], isActive: staff.isActive,
    lastLoginAt: staff.lastLoginAt, createdAt: staff.createdAt, updatedAt: staff.updatedAt,
  };
}

function safePartner(partner) {
  if (!partner) return null;
  return {
    id: String(partner._id), applicationNumber: partner.applicationNumber, partnerType: partner.partnerType || "company",
    companyName: partner.company?.name || "", contactName: partner.contact?.name || "", designation: partner.contact?.designation || "",
    mobile: partner.contact?.mobile || "", alternateMobile: partner.contact?.alternateMobile || "", email: partner.contact?.email || "",
    city: partner.address?.city || "", state: partner.address?.state || "", areasOfOperation: partner.business?.areasOfOperation || [],
    preferredSegments: partner.business?.preferredSegments || [], status: partner.status, registeredAt: partner.createdAt || partner.submittedAt,
  };
}

function presentedProfile(profile) {
  return {
    id: String(profile._id), partner: safePartner(profile.partnerId),
    assignedEmployee: profile.assignedEmployeeId && typeof profile.assignedEmployeeId === "object" ? publicStaff(profile.assignedEmployeeId) : null,
    assignedEmployeeId: profile.assignedEmployeeId ? String(profile.assignedEmployeeId._id || profile.assignedEmployeeId) : "",
    stage: profile.stage, priority: profile.priority, lastInteractionAt: profile.lastInteractionAt,
    lastContactedAt: profile.lastContactedAt, nextFollowUpAt: profile.nextFollowUpAt,
    callAttempts: profile.callAttempts || 0, completedCalls: profile.completedCalls || 0,
    whatsappOpened: profile.whatsappOpened || 0, whatsappSent: profile.whatsappSent || 0,
    whatsappMobile: profile.whatsappMobile || "", whatsappUpdatedAt: profile.whatsappUpdatedAt || null,
  };
}

function stageForOutcome(outcome) {
  if (outcome === "callback_requested") return "callback";
  if (["interested", "needs_project_details"].includes(outcome)) return "interested";
  if (outcome === "has_clients") return "has_clients";
  if (outcome === "not_interested") return "not_interested";
  if (outcome === "do_not_contact") return "do_not_contact";
  return "attempted";
}

function internationalPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits;
}

function normalizeIndianMobile(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

async function ensureProfiles() {
  const partners = await ChannelPartner.find({ status: { $in: ["active", "approved"] } }).select("_id").lean();
  if (!partners.length) return;
  await CPCRMProfile.bulkWrite(partners.map((partner) => ({
    updateOne: { filter: { partnerId: partner._id }, update: { $setOnInsert: { partnerId: partner._id } }, upsert: true },
  })), { ordered: false });
}

async function populateProfiles(query) {
  return query
    .populate({ path: "partnerId", select: "applicationNumber partnerType company.name contact.name contact.designation contact.mobile contact.alternateMobile contact.email address.city address.state business.areasOfOperation business.preferredSegments status createdAt submittedAt" })
    .populate({ path: "assignedEmployeeId", select: "employeeId name phone email role permissions isActive lastLoginAt createdAt updatedAt" });
}

async function profileDetail(profile) {
  const [interactions, followUps, clientsCount, templates] = await Promise.all([
    CPCRMInteraction.find({ partnerId: profile.partnerId._id || profile.partnerId }).sort({ createdAt: -1 }).limit(100).populate("employeeId", "employeeId name").lean(),
    CPCRMFollowUp.find({ partnerId: profile.partnerId._id || profile.partnerId }).sort({ scheduledAt: -1 }).limit(50).populate("employeeId", "employeeId name").lean(),
    ChannelPartnerClient.countDocuments({ partnerId: profile.partnerId._id || profile.partnerId }),
    CPCRMMessageTemplate.find({ isActive: true, $or: [{ audience: { $in: ["all", "registered_cp"] } }, { audience: { $exists: false } }] }).sort({ kind: 1, createdAt: -1 }).lean(),
  ]);
  return {
    profile: presentedProfile(profile), clientsCount,
    interactions: interactions.map((item) => ({ ...item, id: String(item._id), employee: item.employeeId ? { id: String(item.employeeId._id), employeeId: item.employeeId.employeeId, name: item.employeeId.name } : null })),
    followUps: followUps.map((item) => ({ ...item, id: String(item._id), employee: item.employeeId ? { id: String(item.employeeId._id), employeeId: item.employeeId.employeeId, name: item.employeeId.name } : null })),
    templates: templates.map((item) => ({ ...item, id: String(item._id) })),
  };
}

async function staffMetrics(staffId) {
  const now = new Date();
  const { start, end } = indiaDayBounds(now);
  const [registeredAssigned, registeredContacted, registeredCallResults, registeredCallbacksScheduled, registeredCallbacksCompleted, registeredCallbacksDueToday, registeredCallbacksOverdue, registeredWhatsappSent,
    importedAssigned, importedContacted, importedCallResults, importedCallbacksScheduled, importedCallbacksCompleted, importedCallbacksDueToday, importedCallbacksOverdue, importedWhatsappSent, importedStatuses] = await Promise.all([
    CPCRMProfile.countDocuments({ assignedEmployeeId: staffId }),
    CPCRMProfile.countDocuments({ assignedEmployeeId: staffId, lastContactedAt: { $ne: null } }),
    CPCRMInteraction.countDocuments({ employeeId: staffId, action: "call_result" }),
    CPCRMFollowUp.countDocuments({ employeeId: staffId }),
    CPCRMFollowUp.countDocuments({ employeeId: staffId, status: "completed" }),
    CPCRMFollowUp.countDocuments({ employeeId: staffId, status: "pending", scheduledAt: { $gte: start, $lte: end } }),
    CPCRMFollowUp.countDocuments({ employeeId: staffId, status: "pending", scheduledAt: { $lt: now } }),
    CPCRMInteraction.countDocuments({ employeeId: staffId, action: "whatsapp_result", outcome: "sent" }),
    CPProspect.countDocuments({ assignedEmployeeId: staffId }),
    CPProspect.countDocuments({ assignedEmployeeId: staffId, lastContactedAt: { $ne: null } }),
    CPProspectInteraction.countDocuments({ employeeId: staffId, action: { $in: ["verification_result", "broker_call_result"] } }),
    CPProspectFollowUp.countDocuments({ employeeId: staffId }),
    CPProspectFollowUp.countDocuments({ employeeId: staffId, status: "completed" }),
    CPProspectFollowUp.countDocuments({ employeeId: staffId, status: "pending", scheduledAt: { $gte: start, $lte: end } }),
    CPProspectFollowUp.countDocuments({ employeeId: staffId, status: "pending", scheduledAt: { $lt: now } }),
    CPProspectInteraction.countDocuments({ employeeId: staffId, action: "whatsapp_result", outcome: "sent" }),
    CPProspect.aggregate([{ $match: { assignedEmployeeId: staffId } }, { $group: { _id: "$verificationStatus", count: { $sum: 1 } } }]),
  ]);
  const assigned = registeredAssigned + importedAssigned;
  const contacted = registeredContacted + importedContacted;
  const statusCounts = Object.fromEntries(importedStatuses.map((item) => [item._id, item.count]));
  return {
    assigned, pending: Math.max(assigned - contacted, 0), contacted,
    callResults: registeredCallResults + importedCallResults,
    callbacksScheduled: registeredCallbacksScheduled + importedCallbacksScheduled,
    callbacksCompleted: registeredCallbacksCompleted + importedCallbacksCompleted,
    callbacksDueToday: registeredCallbacksDueToday + importedCallbacksDueToday,
    callbacksOverdue: registeredCallbacksOverdue + importedCallbacksOverdue,
    whatsappSent: registeredWhatsappSent + importedWhatsappSent,
    registeredAssigned, importedAssigned,
    active: statusCounts.active || 0,
    inactive: ["inactive", "wrong_number", "not_channel_partner", "duplicate", "do_not_contact"].reduce((sum, status) => sum + (statusCounts[status] || 0), 0),
    callbackRequested: statusCounts.callback_requested || 0,
  };
}

router.post("/auth/login", employeeLoginLimiter, [body("employeeId").trim().isLength({ min: 3, max: 40 }), body("password").isLength({ min: 8, max: 128 })], async (req, res) => {
  try {
    if (validationError(req, res)) return;
    const employeeId = clean(req.body.employeeId, 40).toUpperCase();
    const staff = await CRMStaffAccount.findOne({ employeeId, isDeleted: { $ne: true } }).select("+passwordHash");
    const valid = staff ? await verifyPassword(req.body.password, staff.passwordHash) : false;
    if (!valid) return res.status(401).json({ error: "Invalid employee ID or password." });
    if (!staff.isActive) return res.status(403).json({ error: "This employee account is inactive." });
    staff.lastLoginAt = new Date();
    await staff.save();
    const token = jwt.sign({ staffId: staff._id, tokenType: "crm_staff", role: staff.role, sessionVersion: staff.sessionVersion || 0 }, process.env.JWT_SECRET, { expiresIn: process.env.CRM_STAFF_JWT_EXPIRY || "12h" });
    return res.json({ token, employee: publicStaff(staff) });
  } catch (error) {
    console.error("CRM employee login error:", error);
    return res.status(500).json({ error: "Unable to sign in." });
  }
});

router.get("/auth/me", crmStaffAuth, async (req, res) => res.json({ employee: publicStaff(req.crmStaff) }));

router.get("/admin/employees", auth, adminOnly, async (_req, res) => {
  try {
    const employees = await CRMStaffAccount.find({ isDeleted: { $ne: true } }).sort({ isActive: -1, createdAt: -1 }).lean();
    const rows = await Promise.all(employees.map(async (employee) => ({ ...publicStaff(employee), metrics: await staffMetrics(employee._id) })));
    return res.json({ employees: rows });
  } catch (error) {
    console.error("List CRM employees error:", error);
    return res.status(500).json({ error: "Unable to load employees." });
  }
});

router.get("/admin/employees/:id/activity", auth, adminOnly, async (req, res) => {
  try {
    const employee = await CRMStaffAccount.findById(req.params.id).lean();
    if (!employee || employee.isDeleted) return res.status(404).json({ error: "Employee not found." });
    const [metrics, registeredInteractions, importedInteractions, registeredFollowUps, importedFollowUps, tasks] = await Promise.all([
      staffMetrics(employee._id),
      CPCRMInteraction.find({ employeeId: employee._id }).sort({ createdAt: -1 }).limit(500).populate("partnerId", "applicationNumber company.name contact.name contact.mobile").lean(),
      CPProspectInteraction.find({ employeeId: employee._id }).sort({ createdAt: -1 }).limit(500).populate("prospectId", "company.name contact.name contact.mobile prospectType").lean(),
      CPCRMFollowUp.find({ employeeId: employee._id }).sort({ scheduledAt: -1 }).limit(500).populate("partnerId", "applicationNumber company.name contact.name contact.mobile").lean(),
      CPProspectFollowUp.find({ employeeId: employee._id }).sort({ scheduledAt: -1 }).limit(500).populate("prospectId", "company.name contact.name contact.mobile prospectType").lean(),
      CPCRMTask.find({ employeeId: employee._id }).sort({ createdAt: -1 }).limit(50).lean(),
    ]);
    const interactions = [
      ...registeredInteractions.map((item) => ({ ...item, id: String(item._id), source: "registered", partner: item.partnerId ? { id: String(item.partnerId._id), applicationNumber: item.partnerId.applicationNumber, companyName: item.partnerId.company?.name || "", contactName: item.partnerId.contact?.name || "", mobile: item.partnerId.contact?.mobile || "" } : null })),
      ...importedInteractions.map((item) => ({ ...item, id: String(item._id), source: item.prospectId?.prospectType === "broker" ? "broker" : "imported", partner: item.prospectId ? { id: String(item.prospectId._id), applicationNumber: "", companyName: item.prospectId.company?.name || "", contactName: item.prospectId.contact?.name || "", mobile: item.prospectId.contact?.mobile || "" } : null })),
    ].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)).slice(0, 500);
    const followUps = [
      ...registeredFollowUps.map((item) => ({ ...item, id: String(item._id), source: "registered", partner: item.partnerId ? { id: String(item.partnerId._id), companyName: item.partnerId.company?.name || "" } : null })),
      ...importedFollowUps.map((item) => ({ ...item, id: String(item._id), source: item.prospectId?.prospectType === "broker" ? "broker" : "imported", partner: item.prospectId ? { id: String(item.prospectId._id), companyName: item.prospectId.company?.name || item.prospectId.contact?.name || "" } : null })),
    ].sort((left, right) => new Date(right.scheduledAt) - new Date(left.scheduledAt)).slice(0, 500);
    return res.json({
      employee: publicStaff(employee), metrics,
      interactions,
      followUps,
      tasks: tasks.map((item) => ({ ...item, id: String(item._id) })),
    });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Employee not found." });
    return res.status(500).json({ error: "Unable to load employee activity." });
  }
});

router.post("/admin/employees", auth, adminOnly, [
  body("employeeId").trim().matches(/^[A-Za-z0-9._-]{3,40}$/).withMessage("Employee ID can contain letters, numbers, dots, underscores, and hyphens."),
  body("name").trim().isLength({ min: 2, max: 120 }).withMessage("Enter the employee name."),
  body("password").isLength({ min: 8, max: 128 }).withMessage("Password must contain at least 8 characters."),
], async (req, res) => {
  try {
    if (validationError(req, res)) return;
    const employeeId = clean(req.body.employeeId, 40).toUpperCase();
    if (await CRMStaffAccount.exists({ employeeId })) return res.status(409).json({ error: "That employee ID already exists." });
    const permissions = Array.isArray(req.body.permissions) && req.body.permissions.length ? req.body.permissions : DEFAULT_PERMISSIONS;
    const employee = await CRMStaffAccount.create({
      employeeId, name: clean(req.body.name, 120), phone: clean(req.body.phone, 20), email: clean(req.body.email, 254).toLowerCase(),
      passwordHash: await hashPassword(req.body.password), role: req.body.role === "manager" ? "manager" : "employee",
      permissions, createdBy: req.user._id,
    });
    return res.status(201).json({ message: "Employee account created.", employee: publicStaff(employee) });
  } catch (error) {
    console.error("Create CRM employee error:", error);
    return res.status(500).json({ error: "Unable to create employee." });
  }
});

router.patch("/admin/employees/:id", auth, adminOnly, async (req, res) => {
  try {
    const employee = await CRMStaffAccount.findById(req.params.id);
    if (!employee || employee.isDeleted) return res.status(404).json({ error: "Employee not found." });
    if (req.body.name !== undefined) employee.name = clean(req.body.name, 120);
    if (req.body.phone !== undefined) employee.phone = clean(req.body.phone, 20);
    if (req.body.email !== undefined) employee.email = clean(req.body.email, 254).toLowerCase();
    if (req.body.role !== undefined) employee.role = req.body.role === "manager" ? "manager" : "employee";
    if (Array.isArray(req.body.permissions)) employee.permissions = req.body.permissions;
    if (typeof req.body.isActive === "boolean" && employee.isActive !== req.body.isActive) {
      employee.isActive = req.body.isActive;
      employee.sessionVersion += 1;
    }
    await employee.save();
    return res.json({ message: "Employee updated.", employee: publicStaff(employee) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Employee not found." });
    return res.status(500).json({ error: "Unable to update employee." });
  }
});

router.post("/admin/employees/:id/reset-password", auth, adminOnly, [body("password").isLength({ min: 8, max: 128 }).withMessage("Password must contain at least 8 characters.")], async (req, res) => {
  try {
    if (validationError(req, res)) return;
    const employee = await CRMStaffAccount.findById(req.params.id).select("+passwordHash");
    if (!employee || employee.isDeleted) return res.status(404).json({ error: "Employee not found." });
    employee.passwordHash = await hashPassword(req.body.password);
    employee.sessionVersion += 1;
    await employee.save();
    return res.json({ message: "Password reset. Existing employee sessions were signed out." });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Employee not found." });
    return res.status(500).json({ error: "Unable to reset password." });
  }
});

router.delete("/admin/employees/:id", auth, adminOnly, async (req, res) => {
  try {
    const employee = await CRMStaffAccount.findById(req.params.id);
    if (!employee || employee.isDeleted) return res.status(404).json({ error: "Employee not found." });
    employee.isActive = false;
    employee.isDeleted = true;
    employee.deletedAt = new Date();
    employee.deletedBy = req.user._id;
    employee.sessionVersion += 1;
    await employee.save();

    const [registered, imported] = await Promise.all([
      CPCRMProfile.updateMany({ assignedEmployeeId: employee._id }, { $set: { assignedEmployeeId: null } }),
      CPProspect.updateMany({ assignedEmployeeId: employee._id }, { $set: { assignedEmployeeId: null, assignedAt: null, assignedBy: null } }),
      CPCRMTask.updateMany({ employeeId: employee._id, status: "active" }, { $set: { status: "cancelled" } }),
      CPCRMTaskItem.updateMany({ employeeId: employee._id, status: "pending" }, { $set: { status: "skipped" } }),
      CPCRMFollowUp.updateMany({ employeeId: employee._id, status: "pending" }, { $set: { status: "cancelled" } }),
      CPProspectFollowUp.updateMany({ employeeId: employee._id, status: "pending" }, { $set: { status: "cancelled" } }),
    ]);
    return res.json({
      message: `${employee.name} was deleted. Assigned contacts are available for reassignment.`,
      unassigned: { registered: registered.modifiedCount, imported: imported.modifiedCount },
    });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Employee not found." });
    console.error("Delete CRM employee error:", error);
    return res.status(500).json({ error: "Unable to delete employee." });
  }
});

router.get("/admin/tasks", auth, adminOnly, async (_req, res) => {
  try {
    const tasks = await CPCRMTask.find().sort({ createdAt: -1 }).limit(100).populate("employeeId", "employeeId name").lean();
    return res.json({ tasks: tasks.map((task) => ({ ...task, id: String(task._id), employee: task.employeeId ? { id: String(task.employeeId._id), employeeId: task.employeeId.employeeId, name: task.employeeId.name } : null })) });
  } catch { return res.status(500).json({ error: "Unable to load tasks." }); }
});

router.post("/admin/tasks", auth, adminOnly, [body("employeeId").isMongoId(), body("count").isInt({ min: 1, max: 500 })], async (req, res) => {
  try {
    if (validationError(req, res)) return;
    const employee = await CRMStaffAccount.findOne({ _id: req.body.employeeId, isActive: true, isDeleted: { $ne: true } });
    if (!employee) return res.status(404).json({ error: "Active employee not found." });
    const assignedPartnerIds = await CPCRMProfile.distinct("partnerId", { assignedEmployeeId: { $ne: null } });
    const partners = await ChannelPartner.find({ _id: { $nin: assignedPartnerIds }, status: { $in: ["active", "approved"] } }).sort({ createdAt: 1 }).limit(Number(req.body.count)).select("_id").lean();
    if (!partners.length) return res.status(409).json({ error: "There are no unassigned active Channel Partners." });
    const task = await CPCRMTask.create({
      title: clean(req.body.title, 160) || `Contact ${partners.length} Channel Partners`, instructions: clean(req.body.instructions, 2000),
      employeeId: employee._id, targetCount: Number(req.body.count), assignedCount: partners.length,
      dueAt: req.body.dueAt ? new Date(req.body.dueAt) : null, createdBy: req.user._id,
    });
    await CPCRMProfile.bulkWrite(partners.map((partner) => ({ updateOne: { filter: { partnerId: partner._id }, update: { $set: { assignedEmployeeId: employee._id }, $setOnInsert: { partnerId: partner._id } }, upsert: true } })));
    await CPCRMTaskItem.insertMany(partners.map((partner) => ({ taskId: task._id, partnerId: partner._id, employeeId: employee._id })));
    return res.status(201).json({ message: `${partners.length} Channel Partner${partners.length === 1 ? "" : "s"} assigned to ${employee.name}.`, task: { ...task.toObject(), id: String(task._id) } });
  } catch (error) {
    console.error("Create CRM task error:", error);
    return res.status(500).json({ error: "Unable to create assignment." });
  }
});

router.get("/admin/partners", auth, adminOnly, async (req, res) => {
  try {
    await ensureProfiles();
    const filter = {};
    if (req.query.employeeId === "unassigned") filter.assignedEmployeeId = null;
    else if (req.query.employeeId) filter.assignedEmployeeId = req.query.employeeId;
    if (req.query.stage && CPCRMProfile.STAGES.includes(req.query.stage)) filter.stage = req.query.stage;
    let profiles = await populateProfiles(CPCRMProfile.find(filter).sort({ nextFollowUpAt: 1, createdAt: -1 }));
    profiles = profiles.filter((profile) => profile.partnerId);
    const search = clean(req.query.search, 120).toLowerCase();
    if (search) profiles = profiles.filter((profile) => profile.whatsappMobile?.includes(search) || Object.values(safePartner(profile.partnerId)).some((value) => String(value || "").toLowerCase().includes(search)));
    const page = Math.max(Number(req.query.page) || 1, 1); const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const paged = profiles.slice((page - 1) * limit, page * limit);
    return res.json({ partners: paged.map(presentedProfile), pagination: { page, limit, total: profiles.length, pages: Math.ceil(profiles.length / limit) } });
  } catch (error) {
    console.error("List CRM partners error:", error);
    return res.status(500).json({ error: "Unable to load CP CRM." });
  }
});

router.get("/admin/partners/:partnerId", auth, adminOnly, async (req, res) => {
  try {
    let profile = await CPCRMProfile.findOne({ partnerId: req.params.partnerId });
    if (!profile && await ChannelPartner.exists({ _id: req.params.partnerId })) profile = await CPCRMProfile.create({ partnerId: req.params.partnerId });
    if (!profile) return res.status(404).json({ error: "Channel Partner not found." });
    profile = await populateProfiles(CPCRMProfile.findById(profile._id));
    return res.json(await profileDetail(profile));
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Channel Partner not found." });
    return res.status(500).json({ error: "Unable to load CP details." });
  }
});

router.patch("/admin/partners/:partnerId/assign", auth, adminOnly, async (req, res) => {
  try {
    const employeeId = req.body.employeeId || null;
    if (employeeId && !await CRMStaffAccount.exists({ _id: employeeId, isActive: true, isDeleted: { $ne: true } })) return res.status(404).json({ error: "Active employee not found." });
    const profile = await CPCRMProfile.findOneAndUpdate({ partnerId: req.params.partnerId }, { $set: { assignedEmployeeId: employeeId } }, { new: true, upsert: true, setDefaultsOnInsert: true });
    return res.json({ message: employeeId ? "Channel Partner assigned." : "Channel Partner unassigned.", profile: presentedProfile(profile) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Channel Partner or employee not found." });
    return res.status(500).json({ error: "Unable to update assignment." });
  }
});

router.get("/admin/templates", auth, adminOnly, async (_req, res) => {
  const templates = await CPCRMMessageTemplate.find().sort({ isActive: -1, createdAt: -1 }).lean();
  return res.json({ templates: templates.map((item) => ({ ...item, id: String(item._id) })) });
});

router.post("/admin/templates", auth, adminOnly, [body("name").trim().isLength({ min: 2, max: 120 }), body("kind").isIn(["project", "follow_up"]), body("body").trim().isLength({ min: 1, max: 5000 })], async (req, res) => {
  try {
    if (validationError(req, res)) return;
    const attachments = Array.isArray(req.body.attachments) ? req.body.attachments.slice(0, 12).map((item) => ({ title: clean(item.title, 160), url: clean(item.url, 1000), mimeType: clean(item.mimeType, 100), bytes: Number(item.bytes) || 0 })).filter((item) => item.title && /^https:\/\//i.test(item.url)) : [];
    const audience = TEMPLATE_AUDIENCES.has(req.body.audience) ? req.body.audience : "all";
    const template = await CPCRMMessageTemplate.create({ name: clean(req.body.name, 120), kind: req.body.kind, audience, projectName: clean(req.body.projectName, 180), body: clean(req.body.body, 5000), attachments, createdBy: req.user._id });
    return res.status(201).json({ message: "Message template created.", template: { ...template.toObject(), id: String(template._id) } });
  } catch { return res.status(500).json({ error: "Unable to create message template." }); }
});

router.patch("/admin/templates/:id", auth, adminOnly, async (req, res) => {
  try {
    const template = await CPCRMMessageTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ error: "Message template not found." });
    if (typeof req.body.isActive === "boolean") template.isActive = req.body.isActive;
    if (req.body.name !== undefined) template.name = clean(req.body.name, 120);
    if (req.body.body !== undefined) template.body = clean(req.body.body, 5000);
    if (req.body.projectName !== undefined) template.projectName = clean(req.body.projectName, 180);
    if (req.body.audience !== undefined && TEMPLATE_AUDIENCES.has(req.body.audience)) template.audience = req.body.audience;
    await template.save();
    return res.json({ message: "Message template updated.", template: { ...template.toObject(), id: String(template._id) } });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Message template not found." });
    return res.status(500).json({ error: "Unable to update message template." });
  }
});

router.get("/mine/dashboard", crmStaffAuth, requireCrmPermission("cp_crm.view"), async (req, res) => {
  try {
    const [metrics, tasks] = await Promise.all([
      staffMetrics(req.crmStaff._id),
      CPCRMTask.find({ employeeId: req.crmStaff._id, status: "active" }).sort({ dueAt: 1, createdAt: -1 }).lean(),
    ]);
    return res.json({ employee: publicStaff(req.crmStaff), metrics, tasks: tasks.map((task) => ({ ...task, id: String(task._id) })), serverNow: new Date().toISOString() });
  } catch { return res.status(500).json({ error: "Unable to load employee dashboard." }); }
});

router.get("/mine/partners", crmStaffAuth, requireCrmPermission("cp_crm.view"), async (req, res) => {
  try {
    const filter = { assignedEmployeeId: req.crmStaff._id };
    if (req.query.stage && CPCRMProfile.STAGES.includes(req.query.stage)) filter.stage = req.query.stage;
    if (req.query.due === "today") { const { start, end } = indiaDayBounds(); filter.nextFollowUpAt = { $gte: start, $lte: end }; }
    if (req.query.due === "overdue") filter.nextFollowUpAt = { $lt: new Date() };
    let profiles = await populateProfiles(CPCRMProfile.find(filter).sort({ nextFollowUpAt: 1, createdAt: 1 }));
    profiles = profiles.filter((profile) => profile.partnerId);
    const search = clean(req.query.search, 120).toLowerCase();
    if (search) profiles = profiles.filter((profile) => Object.values(safePartner(profile.partnerId)).some((value) => String(value || "").toLowerCase().includes(search)));
    return res.json({ partners: profiles.map(presentedProfile) });
  } catch { return res.status(500).json({ error: "Unable to load assigned Channel Partners." }); }
});

async function ownedProfile(req, res) {
  const profile = await populateProfiles(CPCRMProfile.findOne({ partnerId: req.params.partnerId, assignedEmployeeId: req.crmStaff._id }));
  if (!profile) res.status(404).json({ error: "This Channel Partner is not assigned to you." });
  return profile;
}

router.get("/mine/partners/:partnerId", crmStaffAuth, requireCrmPermission("cp_crm.view"), async (req, res) => {
  try { const profile = await ownedProfile(req, res); if (!profile) return; return res.json(await profileDetail(profile)); }
  catch (error) { if (error.name === "CastError") return res.status(404).json({ error: "Channel Partner not found." }); return res.status(500).json({ error: "Unable to load CP details." }); }
});

router.post("/mine/partners/:partnerId/call-start", crmStaffAuth, requireCrmPermission("cp_crm.contact"), async (req, res) => {
  try {
    const profile = await ownedProfile(req, res); if (!profile) return;
    const taskItem = await CPCRMTaskItem.findOne({ partnerId: req.params.partnerId, employeeId: req.crmStaff._id, status: "pending" }).sort({ createdAt: 1 });
    const interaction = await CPCRMInteraction.create({ partnerId: req.params.partnerId, employeeId: req.crmStaff._id, taskId: taskItem?.taskId || null, action: "call_started" });
    profile.callAttempts += 1; profile.lastInteractionAt = interaction.createdAt; if (profile.stage === "new") profile.stage = "attempted"; await profile.save();
    return res.status(201).json({ interactionId: String(interaction._id), dialNumber: profile.partnerId.contact.mobile });
  } catch { return res.status(500).json({ error: "Unable to start the call." }); }
});

router.post("/mine/partners/:partnerId/call-result", crmStaffAuth, requireCrmPermission("cp_crm.contact"), async (req, res) => {
  try {
    const profile = await ownedProfile(req, res); if (!profile) return;
    const outcome = clean(req.body.outcome, 60);
    if (!CALL_OUTCOMES.has(outcome)) return res.status(400).json({ error: "Choose a valid call result." });
    const note = clean(req.body.note, 2000);
    if (outcome === "other" && !note) return res.status(400).json({ error: "Enter a note for the Other result." });
    let callbackAt = null;
    if (outcome === "callback_requested") {
      callbackAt = new Date(req.body.callbackAt);
      if (Number.isNaN(callbackAt.getTime()) || callbackAt <= new Date()) return res.status(400).json({ error: "Choose a future callback date and time." });
    }
    const taskItems = await CPCRMTaskItem.find({ partnerId: req.params.partnerId, employeeId: req.crmStaff._id, status: "pending" });
    const interaction = await CPCRMInteraction.create({ partnerId: req.params.partnerId, employeeId: req.crmStaff._id, taskId: taskItems[0]?.taskId || null, action: "call_result", outcome, note, callbackAt });
    const now = new Date();
    const pendingFollowUp = await CPCRMFollowUp.findOne({ partnerId: req.params.partnerId, employeeId: req.crmStaff._id, status: "pending" }).sort({ scheduledAt: 1 });
    if (pendingFollowUp) { pendingFollowUp.status = "completed"; pendingFollowUp.completedAt = now; pendingFollowUp.completionInteractionId = interaction._id; await pendingFollowUp.save(); }
    if (callbackAt) await CPCRMFollowUp.create({ partnerId: req.params.partnerId, employeeId: req.crmStaff._id, sourceInteractionId: interaction._id, scheduledAt: callbackAt, priority: ["important", "urgent"].includes(req.body.priority) ? req.body.priority : "normal", note });
    profile.stage = stageForOutcome(outcome); profile.priority = ["important", "urgent"].includes(req.body.priority) ? req.body.priority : profile.priority;
    profile.lastInteractionAt = now; profile.lastContactedAt = now; profile.completedCalls += 1; profile.nextFollowUpAt = callbackAt; await profile.save();
    for (const item of taskItems) {
      item.status = "completed"; item.outcome = outcome; item.completedAt = now; await item.save();
      const remaining = await CPCRMTaskItem.countDocuments({ taskId: item.taskId, status: "pending" });
      const completed = await CPCRMTaskItem.countDocuments({ taskId: item.taskId, status: "completed" });
      await CPCRMTask.updateOne({ _id: item.taskId }, { $set: { completedCount: completed, ...(remaining === 0 ? { status: "completed" } : {}) } });
    }
    return res.status(201).json({ message: callbackAt ? "Call saved and callback scheduled." : "Call result saved.", interaction: { ...interaction.toObject(), id: String(interaction._id) } });
  } catch (error) {
    console.error("Save CRM call result error:", error);
    return res.status(500).json({ error: "Unable to save the call result." });
  }
});

router.post("/mine/partners/:partnerId/whatsapp-open", crmStaffAuth, requireCrmPermission("cp_crm.contact"), async (req, res) => {
  try {
    const profile = await ownedProfile(req, res); if (!profile) return;
    const messageBody = clean(req.body.messageBody, 5000);
    if (!messageBody) return res.status(400).json({ error: "Choose or enter a WhatsApp message." });
    const whatsappMobile = profile.whatsappMobile || profile.partnerId.contact.mobile;
    const number = internationalPhone(whatsappMobile);
    if (number.length < 10) return res.status(400).json({ error: "The WhatsApp number is invalid." });
    const interaction = await CPCRMInteraction.create({ partnerId: req.params.partnerId, employeeId: req.crmStaff._id, action: "whatsapp_opened", messageBody, templateId: req.body.templateId || null, metadata: { whatsappMobile, usesAlternateNumber: Boolean(profile.whatsappMobile) } });
    profile.whatsappOpened += 1; profile.lastInteractionAt = interaction.createdAt; await profile.save();
    return res.status(201).json({ interactionId: String(interaction._id), whatsappUrl: `https://wa.me/${number}?text=${encodeURIComponent(messageBody)}` });
  } catch (error) {
    if (error.name === "CastError") return res.status(400).json({ error: "Invalid WhatsApp template." });
    return res.status(500).json({ error: "Unable to open WhatsApp." });
  }
});

router.patch("/mine/partners/:partnerId/whatsapp-number", crmStaffAuth, requireCrmPermission("cp_crm.contact"), async (req, res) => {
  try {
    const profile = await ownedProfile(req, res); if (!profile) return;
    const previousNumber = profile.whatsappMobile || "";
    const whatsappMobile = req.body.whatsappMobile ? normalizeIndianMobile(req.body.whatsappMobile) : "";
    if (whatsappMobile && !MOBILE.test(whatsappMobile)) return res.status(400).json({ error: "Enter a valid 10-digit Indian WhatsApp number." });
    if (whatsappMobile === profile.partnerId.contact.mobile) return res.status(400).json({ error: "This is already the primary mobile number. Use the primary number instead." });
    if (whatsappMobile === previousNumber) return res.json({ message: "WhatsApp number is already up to date.", whatsappMobile, whatsappUpdatedAt: profile.whatsappUpdatedAt });
    const now = new Date();
    profile.whatsappMobile = whatsappMobile;
    profile.whatsappUpdatedAt = now;
    profile.whatsappUpdatedBy = req.crmStaff._id;
    profile.lastInteractionAt = now;
    await profile.save();
    await CPCRMInteraction.create({ partnerId: req.params.partnerId, employeeId: req.crmStaff._id, action: "whatsapp_number_updated", note: whatsappMobile ? `WhatsApp number changed to ${whatsappMobile}.` : `WhatsApp reset to primary number ${profile.partnerId.contact.mobile}.`, metadata: { previousNumber, whatsappMobile, usesPrimaryNumber: !whatsappMobile } });
    return res.json({ message: whatsappMobile ? "WhatsApp number saved." : "WhatsApp reset to the primary mobile number.", whatsappMobile, whatsappUpdatedAt: now });
  } catch (error) {
    return res.status(error.name === "CastError" ? 404 : 500).json({ error: "Unable to update the WhatsApp number." });
  }
});

router.post("/mine/partners/:partnerId/whatsapp-result", crmStaffAuth, requireCrmPermission("cp_crm.contact"), async (req, res) => {
  try {
    const profile = await ownedProfile(req, res); if (!profile) return;
    const outcome = clean(req.body.outcome, 30);
    if (!WHATSAPP_OUTCOMES.has(outcome)) return res.status(400).json({ error: "Choose a valid WhatsApp result." });
    const interaction = await CPCRMInteraction.create({ partnerId: req.params.partnerId, employeeId: req.crmStaff._id, action: "whatsapp_result", outcome, note: clean(req.body.note, 2000), metadata: { openedInteractionId: clean(req.body.interactionId, 80) } });
    profile.lastInteractionAt = interaction.createdAt; if (outcome === "sent") profile.whatsappSent += 1; await profile.save();
    return res.status(201).json({ message: "WhatsApp result saved." });
  } catch { return res.status(500).json({ error: "Unable to save WhatsApp result." }); }
});

router.post("/mine/partners/:partnerId/notes", crmStaffAuth, requireCrmPermission("cp_crm.contact"), async (req, res) => {
  try {
    const profile = await ownedProfile(req, res); if (!profile) return;
    const note = clean(req.body.note, 2000); if (!note) return res.status(400).json({ error: "Enter a note." });
    const interaction = await CPCRMInteraction.create({ partnerId: req.params.partnerId, employeeId: req.crmStaff._id, action: "note", note });
    profile.lastInteractionAt = interaction.createdAt; await profile.save();
    return res.status(201).json({ message: "Note saved." });
  } catch { return res.status(500).json({ error: "Unable to save note." }); }
});

module.exports = router;
