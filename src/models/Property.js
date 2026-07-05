const mongoose = require("mongoose");

const propertySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, default: "", trim: true },
    price: { type: String, required: true },
    pricePerSqft: { type: String, default: "" },
    priceValue: { type: Number, default: 0 }, // numeric price for range filtering/sorting in /api/search
    configs: [{ type: String }],
    area: { type: String, default: "" },
    possession: { type: String, default: "" },
    builder: { type: String, default: "" },
    image: { type: String, default: "" },
    badges: [{ type: String }],
    
    // Which homepage carousel/section this belongs to
    websiteSection: { 
      type: String, 
      enum: ["Handpicked", "Newly Launched", "Search Trends", "Offers", "Featured", "None"], 
      default: "None" 
    },

    // Extended fields
    description: { type: String, default: "" },
    propertyType: { type: String, default: "" },
    bedrooms: { type: Number },
    bathrooms: { type: Number },
    parking: { type: String, default: "" },
    furnishing: { type: String, default: "" },
    facing: { type: String, default: "" },
    floor: { type: String, default: "" },
    transactionType: { type: String, default: "" },
    ageOfProperty: { type: String, default: "" },
    images: [{ type: String }],
    videos: [{ type: String }],
    brochure: { type: String, default: "" },
    brochureName: { type: String, default: "" },
    amenities: [{ type: String }],

    society: {
      security: { type: String, default: "" },
      waterSupply: { type: String, default: "" },
      powerBackup: { type: String, default: "" },
      lift: { type: String, default: "" },
      visitorParking: { type: String, default: "" },
      maintenanceStaff: { type: String, default: "" },
    },

    locality: {
      city: { type: String, default: "" },
      zone: { type: String, default: "" },
      landmark: { type: String, default: "" },
    },

    nearbyAmenities: {
      schools: { type: String, default: "" },
      hospitals: { type: String, default: "" },
      shopping: { type: String, default: "" },
      metro: { type: String, default: "" },
    },

    reraRegistered: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
    published: { type: Boolean, default: true },
    featured: { type: Boolean, default: false },
    postedDate: { type: String, default: () => new Date().toISOString() },

    // Who posted this property
    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// Text index for search
propertySchema.index({ title: "text", subtitle: "text", description: "text" });

module.exports = mongoose.model("Property", propertySchema);
