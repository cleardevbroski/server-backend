const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema({
  url: { type: String, required: true, trim: true },
  originalName: { type: String, default: "", trim: true, maxlength: 180 },
  mimeType: { type: String, enum: ["image/jpeg", "image/png", "application/pdf"], required: true },
  bytes: { type: Number, min: 1, max: 10 * 1024 * 1024, required: true },
  uploadedAt: { type: Date, default: Date.now },
}, { _id: false });

const reviewEntrySchema = new mongoose.Schema({
  fromStatus: { type: String, default: "" },
  toStatus: { type: String, required: true },
  note: { type: String, default: "", trim: true, maxlength: 2000 },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const noteSchema = new mongoose.Schema({
  note: { type: String, required: true, trim: true, maxlength: 2000 },
  adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const channelPartnerSchema = new mongoose.Schema({
  applicationNumber: { type: String, required: true, unique: true, immutable: true, index: true },
  partnerCodeHash: { type: String, required: true, unique: true, sparse: true, immutable: true, select: false },
  partnerCodeEncrypted: { type: String, required: true, immutable: true, select: false },
  partnerCodeLast4: { type: String, required: true, immutable: true },
  activatedAt: { type: Date, required: true, default: Date.now },
  idempotencyKey: { type: String, unique: true, sparse: true, select: false },
  partnerType: { type: String, enum: ["company", "individual"], default: "company", required: true },
  company: {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    businessType: { type: String, enum: ["proprietorship", "partnership", "llp", "private_limited", "individual_consultant", "other"], required: true },
    yearEstablished: { type: Number, min: 1900, max: 2200 },
    panNumber: { type: String, required: true, uppercase: true, trim: true },
    gstNumber: { type: String, default: "", uppercase: true, trim: true },
    reraApplicable: { type: Boolean, default: false },
    reraNumber: { type: String, default: "", uppercase: true, trim: true },
  },
  contact: {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    designation: { type: String, required: true, trim: true, maxlength: 100 },
    mobile: { type: String, required: true, trim: true },
    alternateMobile: { type: String, default: "", trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
  },
  address: {
    line1: { type: String, required: true, trim: true, maxlength: 240 },
    line2: { type: String, default: "", trim: true, maxlength: 240 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, required: true, trim: true, maxlength: 100 },
    pinCode: { type: String, required: true, trim: true },
  },
  business: {
    areasOfOperation: [{ type: String, trim: true, maxlength: 100 }],
    currentProjects: { type: String, default: "", trim: true, maxlength: 1500 },
    developerAssociations: { type: String, default: "", trim: true, maxlength: 1500 },
    teamStrength: { type: String, enum: ["0_2", "3_5", "6_10", "10_plus"] },
    preferredSegments: [{ type: String, enum: ["apartments", "villas", "plots", "commercial", "rentals", "other"] }],
  },
  bank: {
    accountHolderName: { type: String, required: true, trim: true, maxlength: 160 },
    bankName: { type: String, required: true, trim: true, maxlength: 160 },
    branch: { type: String, required: true, trim: true, maxlength: 160 },
    accountNumberEncrypted: { type: String, required: true, select: false },
    accountNumberLast4: { type: String, required: true },
    ifscCode: { type: String, required: true, uppercase: true, trim: true },
  },
  documents: {
    panCard: { type: documentSchema, required: true },
    reraCertificate: { type: documentSchema, default: null },
    gstCertificate: { type: documentSchema, default: null },
    cancelledCheque: { type: documentSchema, required: true },
    visitingCard: { type: documentSchema, default: null },
    companyLogo: { type: documentSchema, default: null },
    signatureUpload: { type: documentSchema, required: true },
  },
  declaration: {
    informationAccurate: { type: Boolean, required: true },
    partnerPolicyAccepted: { type: Boolean, required: true },
    leadPolicyAccepted: { type: Boolean, required: true },
    brokeragePolicyAccepted: { type: Boolean, required: true },
    approvalAcknowledged: { type: Boolean, required: true },
    policyVersion: { type: String, required: true, default: "2026-08-04" },
    acceptedAt: { type: Date, required: true },
  },
  signatory: {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    designation: { type: String, required: true, trim: true, maxlength: 100 },
    signedDate: { type: Date, required: true },
  },
  signature: { mode: { type: String, enum: ["drawn", "uploaded"], required: true } },
  status: { type: String, enum: ["active", "submitted", "under_review", "changes_requested", "resubmitted", "approved", "rejected", "suspended"], default: "active", index: true },
  reviewHistory: { type: [reviewEntrySchema], default: [] },
  internalNotes: { type: [noteSchema], default: [] },
  submittedAt: { type: Date, default: Date.now },
  reviewedAt: { type: Date, default: null },
  approvedAt: { type: Date, default: null },
  rejectedAt: { type: Date, default: null },
}, { timestamps: true });

channelPartnerSchema.index({ status: 1, createdAt: -1 });
channelPartnerSchema.index({ "contact.email": 1 });
channelPartnerSchema.index({ "contact.mobile": 1 });
channelPartnerSchema.index({ "company.panNumber": 1 });
channelPartnerSchema.index({ "company.reraNumber": 1 }, { sparse: true });

module.exports = mongoose.model("ChannelPartner", channelPartnerSchema);
