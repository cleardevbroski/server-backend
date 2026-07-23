const mongoose = require("mongoose");

const lawyerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    qualification: { type: String, required: true, trim: true },
    college: { type: String, required: true, trim: true },
    graduationYear: { type: String, default: "", trim: true },
    experience: { type: String, required: true, trim: true },
    barCouncil: { type: String, required: true, trim: true },
    rating: { type: Number, default: 5, min: 1, max: 5 },
    cases: { type: String, required: true },
    specialty: { type: String, required: true },
    languages: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    bio: { type: String, default: "", trim: true, maxlength: 1000 },
    whatsappNumber: {
      type: String,
      required: true,
      trim: true,
      match: [/^\+?[1-9]\d{9,14}$/, "Enter a valid WhatsApp number with country code"],
    },
    legalDocumentType: { type: String, required: true, trim: true },
    legalDocumentNumber: { type: String, required: true, trim: true },
    legalDocumentUrl: { type: String, required: true, trim: true },
    image: { type: String, default: "" },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "approved" },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Lawyer", lawyerSchema);
