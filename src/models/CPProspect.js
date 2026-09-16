const mongoose = require("mongoose");

const VERIFICATION_STATUSES = [
  "pending", "active", "inactive", "callback_requested", "no_answer", "busy",
  "wrong_number", "not_channel_partner", "duplicate", "do_not_contact", "other",
];
const PROPERTY_TYPES = ["apartments", "villas", "plots", "commercial", "rentals", "other"];

const cpProspectSchema = new mongoose.Schema({
  prospectType: { type: String, enum: ["channel_partner", "broker"], default: "channel_partner", index: true },
  importBatchId: { type: mongoose.Schema.Types.ObjectId, ref: "CPProspectImportBatch", required: true, index: true },
  sourceRowNumber: { type: Number, required: true, min: 2 },
  originalData: { type: mongoose.Schema.Types.Mixed, default: {}, select: false },
  existingPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: "ChannelPartner", default: null, index: true },
  assignedEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "CRMStaffAccount", default: null, index: true },
  assignedAt: { type: Date, default: null },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  verificationStatus: { type: String, enum: VERIFICATION_STATUSES, default: "pending", index: true },
  verifiedAt: { type: Date, default: null },
  lastContactedAt: { type: Date, default: null },
  nextFollowUpAt: { type: Date, default: null, index: true },
  callAttempts: { type: Number, default: 0, min: 0 },
  profileCompletion: { type: Number, default: 0, min: 0, max: 100, index: true },
  partnerType: { type: String, enum: ["", "company", "individual"], default: "" },
  company: {
    name: { type: String, default: "", trim: true, maxlength: 160 },
    businessType: { type: String, default: "", trim: true, maxlength: 40 },
    yearEstablished: { type: Number, min: 1900, max: 2200 },
    panNumberEncrypted: { type: String, default: "", select: false },
    panNumberHash: { type: String, default: "", select: false, index: true },
    panNumberLast4: { type: String, default: "", maxlength: 4 },
    gstNumber: { type: String, default: "", uppercase: true, trim: true, maxlength: 15 },
    reraNumber: { type: String, default: "", uppercase: true, trim: true, maxlength: 80 },
  },
  contact: {
    name: { type: String, default: "", trim: true, maxlength: 120 },
    designation: { type: String, default: "", trim: true, maxlength: 100 },
    mobile: { type: String, required: true, trim: true },
    mobileHash: { type: String, required: true, unique: true, select: false },
    alternateMobile: { type: String, default: "", trim: true },
    email: { type: String, default: "", lowercase: true, trim: true, maxlength: 254 },
  },
  address: {
    line1: { type: String, default: "", trim: true, maxlength: 240 },
    line2: { type: String, default: "", trim: true, maxlength: 240 },
    city: { type: String, default: "", trim: true, maxlength: 100, index: true },
    state: { type: String, default: "", trim: true, maxlength: 100 },
    pinCode: { type: String, default: "", trim: true, maxlength: 6 },
  },
  business: {
    areasOfOperation: [{ type: String, trim: true, maxlength: 100 }],
    currentProjects: { type: String, default: "", trim: true, maxlength: 1500 },
    developerAssociations: { type: String, default: "", trim: true, maxlength: 1500 },
    teamStrength: { type: String, default: "", trim: true, maxlength: 20 },
    preferredSegments: [{ type: String, enum: PROPERTY_TYPES }],
  },
  bank: {
    accountHolderName: { type: String, default: "", trim: true, maxlength: 160 },
    bankName: { type: String, default: "", trim: true, maxlength: 160 },
    branch: { type: String, default: "", trim: true, maxlength: 160 },
    accountNumberEncrypted: { type: String, default: "", select: false },
    accountNumberLast4: { type: String, default: "", maxlength: 4 },
    ifscCode: { type: String, default: "", uppercase: true, trim: true, maxlength: 11 },
  },
  signatory: {
    name: { type: String, default: "", trim: true, maxlength: 120 },
    designation: { type: String, default: "", trim: true, maxlength: 100 },
    signedDate: { type: Date, default: null },
  },
}, { timestamps: true });

cpProspectSchema.index({ assignedEmployeeId: 1, verificationStatus: 1, nextFollowUpAt: 1 });
cpProspectSchema.index({ "address.city": 1, "business.areasOfOperation": 1, "business.preferredSegments": 1 });
cpProspectSchema.index({ importBatchId: 1, sourceRowNumber: 1 }, { unique: true });

const CPProspect = mongoose.model("CPProspect", cpProspectSchema);
CPProspect.VERIFICATION_STATUSES = VERIFICATION_STATUSES;
CPProspect.PROPERTY_TYPES = PROPERTY_TYPES;

module.exports = CPProspect;
