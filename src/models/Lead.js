const mongoose = require("mongoose");

const LEAD_STATUSES = ["new", "contacted", "qualified", "closed"];
const LEAD_SOURCES = ["website_contact", "legal_consultation", "property_interest", "admin_import", "manual"];
const QUALIFICATION_LEVELS = ["unassessed", "low", "warm", "high"];

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 && digits.startsWith("91") ? digits.slice(-10) : digits;
}

const leadSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["contact", "consultation", "property_interest"], required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    phone: { type: String, default: "", trim: true },
    message: { type: String, default: "" },
    category: { type: String, default: "" },
    propertyId: { type: String, default: "", trim: true },
    propertyTitle: { type: String, default: "", trim: true },
    propertyLocation: { type: String, default: "", trim: true },
    propertyUrl: { type: String, default: "", trim: true },
    lawyerId: { type: String, default: "", trim: true },
    lawyerName: { type: String, default: "", trim: true },
    audience: { type: String, enum: ["", "buyer", "builder"], default: "" },
    budget: { type: String, default: "", trim: true },
    action: { type: String, enum: ["", "brochure", "call", "enquiry", "document"], default: "" },
    phaseName: { type: String, default: "", trim: true },
    documentName: { type: String, default: "", trim: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    source: { type: String, enum: LEAD_SOURCES, default: "manual", index: true },
    normalizedPhone: { type: String, default: "", trim: true, index: true },
    normalizedEmail: { type: String, default: "", trim: true, lowercase: true, index: true },
    verificationSource: { type: String, enum: ["manual", "truecaller", "password", "unknown"], default: "manual" },
    phoneVerified: { type: Boolean, default: false },
    consentAt: { type: Date, default: null },
    status: { type: String, enum: LEAD_STATUSES, default: "new" },
    qualificationScore: { type: Number, default: 0, min: 0, max: 100 },
    qualificationLevel: { type: String, enum: QUALIFICATION_LEVELS, default: "unassessed", index: true },
    qualificationReasons: [{ type: String, trim: true, maxlength: 180 }],
    followUpNote: { type: String, default: "", trim: true, maxlength: 2000 },
    followUpHistory: [{
      note: { type: String, required: true, trim: true, maxlength: 2000 },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      createdAt: { type: Date, default: Date.now },
    }],
    assignedTo: { type: String, default: "", trim: true, maxlength: 120 },
    lastContactedAt: { type: Date, default: null },
    qualifiedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

leadSchema.pre("validate", function normalizeLeadIdentity(next) {
  this.normalizedPhone = normalizePhone(this.phone);
  this.normalizedEmail = String(this.email || "").trim().toLowerCase();
  next();
});

// Admin lead list filters by status or type, sorted newest-first (ESR)
leadSchema.index({ status: 1, createdAt: -1 });
leadSchema.index({ type: 1, createdAt: -1 });
leadSchema.index({ source: 1, createdAt: -1 });
leadSchema.index({ qualificationLevel: 1, createdAt: -1 });

const Lead = mongoose.model("Lead", leadSchema);

Lead.STATUSES = LEAD_STATUSES;
Lead.SOURCES = LEAD_SOURCES;
Lead.QUALIFICATION_LEVELS = QUALIFICATION_LEVELS;
Lead.normalizePhone = normalizePhone;

module.exports = Lead;
