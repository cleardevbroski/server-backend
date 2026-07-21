const mongoose = require("mongoose");

const configurationDetailSchema = new mongoose.Schema(
  {
    configuration: { type: String, required: true, trim: true },
    price: { type: String, required: true, trim: true },
    superBuiltUpArea: { type: String, required: true, trim: true },
    carpetArea: { type: String, required: true, trim: true },
    bedrooms: { type: Number, required: true, min: 1 },
    bathrooms: { type: Number, required: true, min: 1 },
    balconies: { type: Number, required: true, min: 0 },
    facings: [{ type: String, trim: true }],
  },
  { _id: false }
);

const villaConfigurationDetailSchema = new mongoose.Schema(
  {
    configuration: { type: String, required: true, trim: true },
    price: { type: String, required: true, trim: true },
    plotArea: { type: String, required: true, trim: true },
    builtUpArea: { type: String, required: true, trim: true },
    superArea: { type: String, required: true, trim: true },
    bedrooms: { type: Number, required: true, min: 1 },
    bathrooms: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const villaDetailsSchema = new mongoose.Schema(
  {
    villaType: { type: String, enum: ["Independent", "Row Villa", "Twin Villa"], required: true },
    configurationDetails: { type: [villaConfigurationDetailSchema], required: true },
    plotDimensions: { type: String, default: "", trim: true },
    numberOfFloors: { type: String, default: "", trim: true },
    plotFacing: {
      type: String,
      enum: ["East", "West", "North", "South", "North-East", "North-West", "South-East", "South-West"],
      required: true,
    },
    cornerPlot: { type: Boolean, required: true },
    roadWidthFacing: { type: String, default: "", trim: true },
    privateGarden: { type: Boolean, required: true },
    privateGardenArea: { type: String, default: "", trim: true },
    privatePool: { type: Boolean, required: true },
    terrace: { type: Boolean, required: true },
    terraceDetails: { type: String, default: "", trim: true },
    gatedCommunity: { type: Boolean, required: true },
  },
  { _id: false }
);

const plotSizeDetailSchema = new mongoose.Schema(
  {
    plotSize: { type: String, required: true, trim: true },
    width: { type: Number, required: true, min: 1 },
    length: { type: Number, required: true, min: 1 },
    areaSqft: { type: Number, required: true, min: 1 },
    pricePerSqft: { type: Number, required: true, min: 1 },
    totalPrice: { type: Number, required: true, min: 1 },
    facings: [{ type: String, trim: true }],
  },
  { _id: false }
);

const plotInventorySchema = new mongoose.Schema(
  {
    plotNumber: { type: String, required: true, trim: true },
    plotSize: { type: String, required: true, trim: true },
    facing: { type: String, required: true, trim: true },
    status: { type: String, enum: ["Available", "Booked", "Sold"], required: true },
    isCorner: { type: Boolean, required: true },
  },
  { _id: false }
);

const plotDetailsSchema = new mongoose.Schema(
  {
    plotSizeDetails: { type: [plotSizeDetailSchema], required: true },
    totalPlots: { type: Number, required: true, min: 1 },
    approvalAuthority: { type: String, enum: ["BMRDA", "BDA", "DTCP", "Panchayat"], required: true },
    approvalNumber: { type: String, default: "", trim: true },
    roadWidth: { type: String, default: "", trim: true },
    civicInfrastructure: {
      undergroundDrainage: { type: String, enum: ["Ready", "Under Development"], required: true },
      electricity: { type: String, enum: ["Ready", "Under Development"], required: true },
      water: { type: String, enum: ["Ready", "Under Development"], required: true },
    },
    layoutMapUrl: { type: String, required: true, trim: true },
    layoutMapType: { type: String, enum: ["image", "pdf"], required: true },
    layoutPossession: {
      status: { type: String, enum: ["Layout Ready", "Under Development"], required: true },
      readyDate: { type: String, default: "" },
      expectedCompletionDate: { type: String, default: "" },
    },
    inventory: { type: [plotInventorySchema], required: true },
  },
  { _id: false }
);

const commercialDetailsSchema = new mongoose.Schema(
  {
    commercialSubtype: { type: String, enum: ["Office Space", "Shop/Showroom", "Warehouse", "Industrial Shed", "Co-working"], required: true },
    carpetArea: { type: String, default: "", trim: true },
    builtUpArea: { type: String, default: "", trim: true },
    superArea: { type: String, default: "", trim: true },
    floor: { type: String, required: true, trim: true },
    totalFloors: { type: Number, required: true, min: 1 },
    frontage: { type: String, default: "", trim: true },
    zoneType: { type: String, enum: ["IT/ITES SEZ", "Non-SEZ", "Retail", "Industrial"], required: true },
    seatingCapacity: { type: Number, min: 0, default: 0 },
    cabins: { type: Number, min: 0, default: 0 },
    meetingRooms: { type: Number, min: 0, default: 0 },
    buildingGrade: { type: String, enum: ["Grade A", "Grade B", "Grade C", "Not Applicable"], required: true },
    structure: { type: String, default: "", trim: true },
    pantry: { type: String, enum: ["None", "Shared Pantry", "Private Pantry"], required: true },
    washrooms: { type: String, default: "", trim: true },
    parking: { type: String, default: "", trim: true },
    powerBackup: { type: String, default: "", trim: true },
    sanctionedLoadKva: { type: Number, min: 0, default: 0 },
    fireSafetyCompliance: { type: String, default: "", trim: true },
    furnishing: { type: String, enum: ["Bare Shell", "Warm Shell", "Fully Furnished"], required: true },
  },
  { _id: false }
);

const pgSharingSchema = new mongoose.Schema({ sharingType: { type: String, enum: ["Single occupancy", "Double sharing", "Triple sharing", "Four sharing"], required: true }, rentPerBed: { type: Number, required: true, min: 1 }, deposit: { type: Number, required: true, min: 0 }, bedsAvailable: { type: Number, required: true, min: 0 } }, { _id: false });
const pgDetailsSchema = new mongoose.Schema({
  genderPreference: { type: String, enum: ["Men only", "Women only", "Co-ed"], required: true }, sharingDetails: { type: [pgSharingSchema], required: true },
  mealsIncluded: { type: String, enum: ["Breakfast + Dinner", "All 3 meals", "No meals"], required: true }, foodType: { type: String, enum: ["", "Veg only", "Veg + Non-veg"], default: "" },
  wifiIncluded: { type: Boolean, required: true }, laundryIncluded: { type: Boolean, required: true }, laundrySchedule: { type: String, default: "", trim: true }, housekeeping: { type: String, default: "", trim: true },
  curfewEntryTiming: { type: String, default: "", trim: true }, visitorsAllowed: { type: String, default: "", trim: true }, noticePeriod: { type: String, default: "", trim: true }, lockInPeriod: { type: String, default: "", trim: true }, idProofRequired: { type: String, default: "", trim: true }, utilitiesIncluded: { type: String, default: "", trim: true }, availableFrom: { type: String, required: true }, commonAmenities: [{ type: String, trim: true }], contactType: { type: String, enum: ["Owner", "PG Manager", "Company-run"], required: true },
}, { _id: false });

const possessionDetailsSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["Ready to Move", "Under Construction", "New Launch"],
      required: true,
    },
    launchDate: { type: String, default: "" },
    expectedCompletionDate: { type: String, default: "" },
  },
  { _id: false }
);

const nearbyDetailSchema = new mongoose.Schema(
  {
    count: { type: Number, min: 0 },
    distance: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const propertySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, default: "", trim: true },
    price: { type: String, required: true },
    pricePerSqft: { type: String, default: "" },
    priceValue: { type: Number, default: 0 }, // numeric price for range filtering/sorting in /api/search
    configs: [{ type: String }],
    configurationDetails: { type: [configurationDetailSchema], default: undefined },
    villaDetails: { type: villaDetailsSchema, default: undefined },
    plotDetails: { type: plotDetailsSchema, default: undefined },
    commercialDetails: { type: commercialDetailsSchema, default: undefined },
    pgDetails: { type: pgDetailsSchema, default: undefined },
    area: { type: String, default: "" },
    possession: { type: String, default: "" },
    possessionDetails: { type: possessionDetailsSchema, default: undefined },
    builder: { type: String, default: "" },
    image: { type: String, default: "" },
    badges: [{ type: String }],
    
    // Which homepage carousel/section this belongs to
    websiteSection: { 
      type: String, 
      enum: ["Handpicked", "Newly Launched", "Search Trends", "Offers", "Featured", "Recommended Insights", "None"], 
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
    floorLabel: { type: String, default: "", trim: true },
    totalFloors: { type: Number, min: 1 },
    transactionType: { type: String, default: "" },
    listingType: { type: String, enum: ["For Sale", "For Rent"], default: "For Sale" },
    submittedBy: { type: String, enum: ["user", "admin"], default: "admin" },
    ageOfProperty: { type: String, default: "" },
    images: [{ type: String }],
    videos: [{ type: String }],
    brochure: { type: String, default: "" },
    brochureName: { type: String, default: "" },
    virtualTourUrl: { type: String, default: "", trim: true },
    amenities: [{ type: String }],
    ownershipType: { type: String, default: "", trim: true },
    overlooking: [{ type: String, trim: true }],
    bookingAmount: { type: String, default: "", trim: true },
    maintenanceCharges: { type: String, default: "", trim: true },
    maintenancePeriod: {
      type: String,
      enum: ["", "month", "quarter", "year"],
      default: "month",
    },

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
      pinCode: { type: String, default: "", trim: true },
    },

    nearbyAmenities: {
      schools: { type: String, default: "" },
      hospitals: { type: String, default: "" },
      shopping: { type: String, default: "" },
      metro: { type: String, default: "" },
    },

    nearbyDetails: {
      schools: { type: nearbyDetailSchema, default: undefined },
      hospitals: { type: nearbyDetailSchema, default: undefined },
      shopping: { type: nearbyDetailSchema, default: undefined },
      metro: { type: nearbyDetailSchema, default: undefined },
    },

    reraRegistered: { type: Boolean, default: false },
    reraNumber: { type: String, default: "", trim: true },
    verified: { type: Boolean, default: false },
    published: { type: Boolean, default: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "approved" },
    featured: { type: Boolean, default: false },
    postedDate: { type: String, default: () => new Date().toISOString() },

    // Who posted this property
    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Relational links set by an admin (null = unlinked; falls back to free-text `builder` / dealer heuristics)
    builderId: { type: mongoose.Schema.Types.ObjectId, ref: "Builder", default: null },
    dealerId: { type: mongoose.Schema.Types.ObjectId, ref: "Dealer", default: null },
  },
  {
    timestamps: true,
  }
);

// Derive numeric priceValue from the display price string (e.g. "₹1.2 Cr", "85 L", "4500000")
function parsePriceValue(price) {
  const m = String(price || "")
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)\s*(cr|crore|l|lac|lakh)?/i);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return 0;
  const unit = (m[2] || "").toLowerCase();
  if (unit.startsWith("cr")) return Math.round(num * 1e7);
  if (unit.startsWith("l")) return Math.round(num * 1e5);
  return Math.round(num);
}

// Keep priceValue in sync with price so /api/search range filters work on real data.
// An explicitly set priceValue still wins (isModified is false for schema defaults).
propertySchema.pre("save", function (next) {
  if (this.isModified("price") && !this.isModified("priceValue")) {
    this.priceValue = parsePriceValue(this.price);
  }
  next();
});

// Text index for search
propertySchema.index({
  title: "text",
  subtitle: "text",
  description: "text",
  builder: "text",
  configs: "text",
  "locality.city": "text",
  "locality.zone": "text",
  "locality.landmark": "text",
  "villaDetails.villaType": "text",
  "villaDetails.plotFacing": "text",
  "plotDetails.approvalAuthority": "text",
  "plotDetails.plotSizeDetails.plotSize": "text",
  "commercialDetails.commercialSubtype": "text",
  "commercialDetails.zoneType": "text",
  "commercialDetails.buildingGrade": "text",
  "pgDetails.genderPreference": "text",
  "pgDetails.sharingDetails.sharingType": "text",
});

// Default public listing: status equality + newest-first sort (ESR)
propertySchema.index({ status: 1, createdAt: -1 });
// Relational link lookups + unset cascade (see propertyLinkSync)
propertySchema.index({ builderId: 1 });
propertySchema.index({ dealerId: 1 });
// Numeric price range filter in /api/search
propertySchema.index({ priceValue: 1 });
// Case-insensitive exact-match filters (queries must request the same collation).
// strength:2 = case-insensitive; createdAt second key serves the default sort (ESR).
const CI_COLLATION = { locale: "en", strength: 2 };
propertySchema.index({ "locality.city": 1, createdAt: -1 }, { collation: CI_COLLATION });
propertySchema.index({ propertyType: 1, createdAt: -1 }, { collation: CI_COLLATION });

const Property = mongoose.model("Property", propertySchema);
// Shared so route queries request the exact collation these indexes were built with.
Property.CI_COLLATION = CI_COLLATION;

module.exports = Property;
