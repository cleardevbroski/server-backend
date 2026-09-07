const mongoose = require("mongoose");
const { PROPERTY_DOCUMENT_MAX_BYTES } = require("../utils/propertyMediaLimits");

const verificationDocumentRefSchema = new mongoose.Schema({
  document: { type: mongoose.Schema.Types.ObjectId, ref: "PropertyPosterDocument", required: true },
  purpose: { type: String, required: true, trim: true },
  fileName: { type: String, required: true, trim: true },
  mimeType: { type: String, required: true, trim: true },
}, { _id: false });

const propertySubmissionProfileSchema = new mongoose.Schema({
  posterType: { type: String, enum: ["company", "individual"], required: true },
  verifiedEmail: { type: String, required: true, lowercase: true, trim: true },
  consentAcceptedAt: { type: Date, required: true },
  company: {
    companyName: { type: String, default: "", trim: true },
    builderName: { type: String, default: "", trim: true },
    contactPersonName: { type: String, default: "", trim: true },
    designation: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    reraApplicable: { type: Boolean, default: false },
    reraNumber: { type: String, default: "", trim: true },
    panLast4: { type: String, default: "", trim: true },
    panDocument: { type: verificationDocumentRefSchema, default: undefined },
    reraDocument: { type: verificationDocumentRefSchema, default: undefined },
    registrationDocument: { type: verificationDocumentRefSchema, default: undefined },
  },
  individual: {
    ownerName: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    panLast4: { type: String, default: "", trim: true },
    aadhaarLast4: { type: String, default: "", trim: true },
    panDocument: { type: verificationDocumentRefSchema, default: undefined },
    aadhaarDocument: { type: verificationDocumentRefSchema, default: undefined },
    ownershipDocument: { type: verificationDocumentRefSchema, default: undefined },
  },
}, { _id: false });

const planPointSchema = new mongoose.Schema(
  {
    x: { type: Number, min: 0, max: 100 },
    y: { type: Number, min: 0, max: 100 },
  },
  { _id: false }
);

const apartmentRoomSchema = new mongoose.Schema(
  {
    id: { type: String, default: "", trim: true },
    name: { type: String, trim: true },
    category: {
      type: String,
      enum: ["bedroom", "bathroom", "kitchen", "living", "dining", "balcony", "utility", "other"],
      default: "other",
    },
    length: { type: Number, min: 0 },
    width: { type: Number, min: 0 },
    area: { type: Number, min: 0 },
    unit: { type: String, enum: ["ft", "m"], default: "ft" },
    description: { type: String, default: "", trim: true },
    flooring: { type: String, default: "", trim: true },
    polygon: { type: [planPointSchema], default: undefined },
  },
  { _id: false }
);

const configurationDetailSchema = new mongoose.Schema(
  {
    id: { type: String, default: "", trim: true },
    configuration: { type: String, trim: true },
    price: { type: String, trim: true },
    superBuiltUpArea: { type: String, trim: true },
    carpetArea: { type: String, trim: true },
    builtUpArea: { type: String, default: "", trim: true },
    bedrooms: { type: Number, min: 0 },
    bathrooms: { type: Number, min: 0 },
    balconies: { type: Number, min: 0 },
    facings: [{ type: String, trim: true }],
    floorPlan2dUrl: { type: String, default: "", trim: true },
    floorPlan3dUrl: { type: String, default: "", trim: true },
    rooms: { type: [apartmentRoomSchema], default: undefined },
  },
  { _id: false }
);

const facilityDetailSchema = new mongoose.Schema(
  {
    id: { type: String, default: "", trim: true },
    name: { type: String, trim: true },
    category: { type: String, default: "Other", trim: true },
    description: { type: String, default: "", trim: true },
    imageUrl: { type: String, default: "", trim: true },
    status: { type: String, enum: ["Available", "Planned", "Under Construction"], default: "Available" },
    hours: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const villaConfigurationDetailSchema = new mongoose.Schema(
  {
    configuration: { type: String, trim: true },
    bhk: { type: String, default: "", trim: true },
    unitVariant: { type: String, enum: ["Simplex", "Duplex", "Triplex", "Villament", "Penthouse", "Row House", "Independent Villa", "Twin Villa", "Sky Villa", "Luxury Villa", "Mansion", "Custom"] },
    price: { type: String, trim: true },
    plotArea: { type: String, trim: true },
    builtUpArea: { type: String, trim: true },
    carpetArea: { type: String, default: "", trim: true },
    superArea: { type: String, trim: true },
    bedrooms: { type: Number, min: 1 },
    bathrooms: { type: Number, min: 1 },
    balconies: { type: Number, min: 0 },
    plotDimensions: { type: String, default: "", trim: true },
    numberOfFloors: { type: String, default: "", trim: true },
    plotFacing: {
      type: String,
      enum: ["East", "West", "North", "South", "North-East", "North-West", "South-East", "South-West"],
    },
    cornerPlot: { type: Boolean },
    roadWidthFacing: { type: String, default: "", trim: true },
    privateGarden: { type: Boolean },
    privateGardenArea: { type: String, default: "", trim: true },
    privatePool: { type: Boolean },
    terrace: { type: Boolean },
    terraceDetails: { type: String, default: "", trim: true },
    gatedCommunity: { type: Boolean },
  },
  { _id: false }
);

const villaDetailsSchema = new mongoose.Schema(
  {
    villaType: { type: String, enum: ["Independent", "Row Villa", "Twin Villa", "Villament", "Penthouse", "Duplex Villa", "Triplex Villa", "Luxury Villa", "Mansion", "Mixed Villa Development"] },
    configurationDetails: { type: [villaConfigurationDetailSchema] },
    plotDimensions: { type: String, default: "", trim: true },
    numberOfFloors: { type: String, default: "", trim: true },
    plotFacing: {
      type: String,
      enum: ["East", "West", "North", "South", "North-East", "North-West", "South-East", "South-West"],
    },
    cornerPlot: { type: Boolean },
    roadWidthFacing: { type: String, default: "", trim: true },
    privateGarden: { type: Boolean },
    privateGardenArea: { type: String, default: "", trim: true },
    privatePool: { type: Boolean },
    terrace: { type: Boolean },
    terraceDetails: { type: String, default: "", trim: true },
    gatedCommunity: { type: Boolean },
  },
  { _id: false }
);

const plotSizeDetailSchema = new mongoose.Schema(
  {
    plotSize: { type: String, trim: true },
    width: { type: Number, min: 1 },
    length: { type: Number, min: 1 },
    areaSqft: { type: Number, min: 1 },
    pricePerSqft: { type: Number, min: 1 },
    totalPrice: { type: Number, min: 1 },
    facings: [{ type: String, trim: true }],
  },
  { _id: false }
);

const plotInventorySchema = new mongoose.Schema(
  {
    plotNumber: { type: String, trim: true },
    plotSize: { type: String, trim: true },
    facing: { type: String, trim: true },
    status: { type: String, enum: ["Available", "Booked", "Sold"] },
    isCorner: { type: Boolean },
  },
  { _id: false }
);

const plotDetailsSchema = new mongoose.Schema(
  {
    plotSizeDetails: { type: [plotSizeDetailSchema] },
    totalPlots: { type: Number, min: 1 },
    approvalAuthority: { type: String, trim: true, maxlength: 120 },
    approvalNumber: { type: String, default: "", trim: true },
    roadWidth: { type: String, default: "", trim: true },
    civicInfrastructure: {
      undergroundDrainage: { type: String, enum: ["Ready", "Under Development"] },
      electricity: { type: String, enum: ["Ready", "Under Development"] },
      water: { type: String, enum: ["Ready", "Under Development"] },
    },
    layoutMapUrl: { type: String, trim: true },
    layoutMapType: { type: String, enum: ["image", "pdf"] },
    layoutPossession: {
      status: { type: String, enum: ["Layout Ready", "Under Development"] },
      readyDate: { type: String, default: "" },
      expectedCompletionDate: { type: String, default: "" },
    },
    inventory: { type: [plotInventorySchema] },
  },
  { _id: false }
);

const commercialDetailsSchema = new mongoose.Schema(
  {
    commercialSubtype: { type: String, enum: ["Office Space", "Shop/Showroom", "Warehouse", "Industrial Shed", "Co-working"] },
    carpetArea: { type: String, default: "", trim: true },
    builtUpArea: { type: String, default: "", trim: true },
    superArea: { type: String, default: "", trim: true },
    floor: { type: String, trim: true },
    totalFloors: { type: Number, min: 1 },
    frontage: { type: String, default: "", trim: true },
    zoneType: { type: String, enum: ["IT/ITES SEZ", "Non-SEZ", "Retail", "Industrial"] },
    seatingCapacity: { type: Number, min: 0, default: 0 },
    cabins: { type: Number, min: 0, default: 0 },
    meetingRooms: { type: Number, min: 0, default: 0 },
    buildingGrade: { type: String, enum: ["Grade A", "Grade B", "Grade C", "Not Applicable"] },
    structure: { type: String, default: "", trim: true },
    pantry: { type: String, enum: ["None", "Shared Pantry", "Private Pantry"] },
    washrooms: { type: String, default: "", trim: true },
    parking: { type: String, default: "", trim: true },
    powerBackup: { type: String, default: "", trim: true },
    sanctionedLoadKva: { type: Number, min: 0, default: 0 },
    fireSafetyCompliance: { type: String, default: "", trim: true },
    furnishing: { type: String, enum: ["Bare Shell", "Warm Shell", "Fully Furnished"] },
  },
  { _id: false }
);

const pgSharingSchema = new mongoose.Schema({ sharingType: { type: String, enum: ["Single occupancy", "Double sharing", "Triple sharing", "Four sharing"] }, rentPerBed: { type: Number, min: 1 }, deposit: { type: Number, min: 0 }, bedsAvailable: { type: Number, min: 0 } }, { _id: false });
const pgDetailsSchema = new mongoose.Schema({
  genderPreference: { type: String, enum: ["Men only", "Women only", "Co-ed"] }, sharingDetails: { type: [pgSharingSchema] },
  mealsIncluded: { type: String, enum: ["Breakfast + Dinner", "All 3 meals", "No meals"] }, foodType: { type: String, enum: ["", "Veg only", "Veg + Non-veg"], default: "" },
  wifiIncluded: { type: Boolean }, laundryIncluded: { type: Boolean }, laundrySchedule: { type: String, default: "", trim: true }, housekeeping: { type: String, default: "", trim: true },
  curfewEntryTiming: { type: String, default: "", trim: true }, visitorsAllowed: { type: String, default: "", trim: true }, noticePeriod: { type: String, default: "", trim: true }, lockInPeriod: { type: String, default: "", trim: true }, idProofRequired: { type: String, default: "", trim: true }, utilitiesIncluded: { type: String, default: "", trim: true }, availableFrom: { type: String }, commonAmenities: [{ type: String, trim: true }], contactType: { type: String, enum: ["Owner", "PG Manager", "Company-run"] },
}, { _id: false });
const rentDetailsSchema = new mongoose.Schema({ rentalPropertyType: { type: String, enum: ["Apartment", "Villa", "Independent House"] }, configuration: { type: String, trim: true }, monthlyRent: { type: Number, min: 1 }, securityDeposit: { type: Number, min: 0 }, availableFrom: { type: String }, lockInPeriod: { type: String, default: "", trim: true }, preferredTenantTypes: [{ type: String, trim: true }], superArea: { type: String, default: "", trim: true }, carpetArea: { type: String, default: "", trim: true }, bedrooms: { type: Number, min: 0, default: 0 }, bathrooms: { type: Number, min: 0, default: 0 }, floor: { type: String, default: "", trim: true }, totalFloors: { type: Number, min: 1 }, facing: { type: String, default: "", trim: true }, parking: { type: String, default: "", trim: true }, furnishing: { type: String, enum: ["Unfurnished", "Semi-Furnished", "Fully Furnished"] }, petFriendly: { type: Boolean }, nonVegAllowed: { type: Boolean }, contactType: { type: String, enum: ["Owner", "Broker"] } }, { _id: false });

const possessionDetailsSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["Ready to Move", "Under Construction", "New Launch"],
    },
    launchDate: { type: String, default: "" },
    expectedCompletionDate: { type: String, default: "" },
  },
  { _id: false }
);

const projectAreaSchema = new mongoose.Schema(
  {
    totalAcres: { type: Number, min: 0 },
    openSpaceSqft: { type: Number, min: 0 },
    builtUpSqft: { type: Number, min: 0 },
    amenitiesSqft: { type: Number, min: 0 },
    // Legacy fields remain readable for already-published records. New and
    // pending records are normalized into the square-foot fields above.
    openSpaceAcres: { type: Number, min: 0 },
    builtUpAcres: { type: Number, min: 0 },
    amenitiesAcres: { type: Number, min: 0 },
  },
  { _id: false }
);

const projectNarrativeSchema = new mongoose.Schema({
  introduction: [{ type: String, trim: true, maxlength: 3000 }],
  usps: [{ type: String, trim: true, maxlength: 500 }],
  keyDetails: [{
    label: { type: String, trim: true, maxlength: 120 },
    value: { type: String, trim: true, maxlength: 500 },
  }],
  featureGroups: [{
    title: { type: String, trim: true, maxlength: 160 },
    items: [{ type: String, trim: true, maxlength: 500 }],
  }],
  locationAdvantage: [{ type: String, trim: true, maxlength: 2000 }],
  investmentReasons: [{ type: String, trim: true, maxlength: 2000 }],
}, { _id: false });

const masterPlanSchema = new mongoose.Schema({
  imageUrl: { type: String, default: "", trim: true },
  title: { type: String, default: "", trim: true, maxlength: 180 },
  summary: { type: String, default: "", trim: true, maxlength: 5000 },
  sections: [{
    heading: { type: String, trim: true, maxlength: 180 },
    body: { type: String, trim: true, maxlength: 3000 },
  }],
}, { _id: false });

const projectDownloadSchema = new mongoose.Schema({
  kind: { type: String, enum: ["brochure", "master-plan", "walkthrough"], required: true },
  label: { type: String, required: true, trim: true, maxlength: 120 },
  fileName: { type: String, required: true, trim: true, maxlength: 255 },
  fileUrl: { type: String, required: true, trim: true },
  mimeType: { type: String, enum: ["application/pdf", "video/mp4"], required: true },
  fileSize: { type: Number, min: 1, max: PROPERTY_DOCUMENT_MAX_BYTES },
});

const projectFaqSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true, maxlength: 500 },
  answer: { type: String, required: true, trim: true, maxlength: 3000 },
  order: { type: Number, min: 0, default: 0 },
}, { _id: false });

const nearbyDetailSchema = new mongoose.Schema(
  {
    count: { type: Number, min: 0 },
    distance: { type: String, default: "", trim: true },
    places: {
      type: [{
        name: { type: String, required: true, trim: true },
        address: { type: String, default: "", trim: true },
        distance: { type: String, default: "", trim: true },
        landmark: { type: String, default: "", trim: true },
        latitude: { type: Number, min: -90, max: 90 },
        longitude: { type: Number, min: -180, max: 180 },
        osmId: { type: String, default: "", trim: true },
        mapUrl: { type: String, default: "", trim: true },
        resolvedAddress: { type: String, default: "", trim: true },
        approximateDistanceMeters: { type: Number, min: 0 },
      }],
      default: undefined,
    },
  },
  { _id: false }
);

const locationAddressComponentsSchema = new mongoose.Schema({
  road: { type: String, default: "", trim: true },
  neighbourhood: { type: String, default: "", trim: true },
  suburb: { type: String, default: "", trim: true },
  city: { type: String, default: "", trim: true },
  district: { type: String, default: "", trim: true },
  state: { type: String, default: "", trim: true },
  pinCode: { type: String, default: "", trim: true },
  country: { type: String, default: "", trim: true },
}, { _id: false });

const locationComparisonSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  expected: { type: String, default: "", trim: true },
  actual: { type: String, default: "", trim: true },
  passed: { type: Boolean, required: true },
  strong: { type: Boolean, default: false },
  weight: { type: Number, min: 0, max: 100, default: 0 },
}, { _id: false });

const locationVerificationSchema = new mongoose.Schema({
  status: { type: String, enum: ["not_checked", "resolved", "mismatch", "admin_verified"], default: "not_checked" },
  coordinateSource: { type: String, enum: ["manual", "map_url", "imported"], default: "manual" },
  inputLatitude: { type: Number, required: true, min: -90, max: 90 },
  inputLongitude: { type: Number, required: true, min: -180, max: 180 },
  resolvedLatitude: { type: Number, min: -90, max: 90 },
  resolvedLongitude: { type: Number, min: -180, max: 180 },
  resolvedAddress: { type: String, default: "", trim: true, maxlength: 2000 },
  components: { type: locationAddressComponentsSchema, default: undefined },
  osmId: { type: String, default: "", trim: true },
  mapUrl: { type: String, default: "", trim: true },
  provider: { type: String, enum: ["nominatim"], default: "nominatim" },
  matchScore: { type: Number, min: 0, max: 100, default: 0 },
  matches: { type: mongoose.Schema.Types.Mixed, default: undefined },
  comparisons: { type: [locationComparisonSchema], default: undefined },
  mismatchFields: [{ type: String, trim: true }],
  warnings: [{ type: String, trim: true }],
  analyzedAt: { type: Date, required: true },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  verifiedAt: { type: Date, default: null },
}, { _id: false });

const reviewMessageSchema = new mongoose.Schema(
  {
    senderRole: { type: String, enum: ["admin", "user"], required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const propertyWorkflowHistorySchema = new mongoose.Schema({
  fromStatus: { type: String, required: true, trim: true, maxlength: 50 },
  toStatus: { type: String, required: true, trim: true, maxlength: 50 },
  action: { type: String, required: true, trim: true, maxlength: 50 },
  note: { type: String, default: "", trim: true, maxlength: 1000 },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  at: { type: Date, default: Date.now },
}, { _id: false });

const reraDocumentSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  label: { type: String, required: true, trim: true },
  annexure: { type: String, default: "", trim: true },
  fileName: { type: String, required: true, trim: true },
  fileUrl: { type: String, required: true, trim: true },
  mimeType: { type: String, enum: ["application/pdf", "image/jpeg", "image/png"], required: true },
  fileSize: { type: Number, min: 1, max: PROPERTY_DOCUMENT_MAX_BYTES },
  uploadedAt: { type: Date, default: Date.now },
});

const reraOfficialDetailsSchema = new mongoose.Schema({
  promoterName: { type: String, default: "", trim: true, maxlength: 250 },
  projectId: { type: String, default: "", trim: true, maxlength: 100 },
  acknowledgementNumber: { type: String, default: "", trim: true, maxlength: 150 },
  registrationStatus: { type: String, default: "", trim: true, maxlength: 100 },
  district: { type: String, default: "", trim: true, maxlength: 150 },
  approvalDate: { type: String, default: "", trim: true, maxlength: 10 },
  registeredCompletionDate: { type: String, default: "", trim: true, maxlength: 10 },
  registeredAddress: { type: String, default: "", trim: true, maxlength: 1000 },
  promoterAddress: { type: String, default: "", trim: true, maxlength: 1000 },
}, { _id: false });

const reraPhaseSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  reraNumber: { type: String, required: true, trim: true, maxlength: 100 },
  reraSiteUrl: { type: String, default: "https://rera.karnataka.gov.in/viewAllProjects", trim: true, maxlength: 2000 },
  order: { type: Number, min: 0, default: 0 },
  officialDetails: { type: reraOfficialDetailsSchema, default: undefined },
  reraDocuments: { type: [reraDocumentSchema], default: [] },
  projectDocuments: { type: [reraDocumentSchema], default: [] },
});

const acquisitionChargeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  code: { type: String, default: "other", trim: true, lowercase: true, maxlength: 80 },
  calculationType: { type: String, enum: ["fixed", "percentage", "per_sqft", "included", "not_applicable"], default: "fixed" },
  value: { type: Number, min: 0, default: 0 },
  basis: { type: String, enum: ["base_price", "agreement_value", "built_up_area"], default: "base_price" },
  appliesToConfiguration: { type: String, default: "", trim: true, maxlength: 150 },
  paymentTiming: { type: String, enum: ["initial", "monthly", "at_registration", "other"], default: "initial" },
  sourceType: { type: String, enum: ["exact_project_value", "developer_supplied"], default: "developer_supplied" },
  sourceNote: { type: String, default: "", trim: true, maxlength: 500 },
  optional: { type: Boolean, default: false },
}, { _id: false });

const propertySchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    subtitle: { type: String, default: "", trim: true },
    price: { type: String },
    pricePerSqft: { type: String, default: "" },
    priceValue: { type: Number, default: 0 }, // numeric price for range filtering/sorting in /api/search
    priceUpdatedAt: { type: Date, default: null },
    priceSourceType: { type: String, enum: ["exact_project_value", "developer_supplied"], default: "developer_supplied" },
    acquisitionCharges: { type: [acquisitionChargeSchema], default: [] },
    configs: [{ type: String }],
    configurationDetails: { type: [configurationDetailSchema], default: undefined },
    villaDetails: { type: villaDetailsSchema, default: undefined },
    plotDetails: { type: plotDetailsSchema, default: undefined },
    commercialDetails: { type: commercialDetailsSchema, default: undefined },
    pgDetails: { type: pgDetailsSchema, default: undefined },
    rentDetails: { type: rentDetailsSchema, default: undefined },
    leaseDetails: {
      leasePropertyType: { type: String, enum: ["Commercial", "Residential"] },
      carpetArea: { type: String, default: "" }, superArea: { type: String, default: "" },
      leaseRent: { type: Number, min: 1 }, rentPerSqft: { type: Number, min: 0 },
      leaseTenure: { type: String, default: "" }, lockInPeriod: { type: String, default: "" }, rentEscalation: { type: String, default: "" },
      securityDeposit: { type: Number, min: 0 }, availableFrom: { type: String, default: "" },
      furnishing: { type: String, default: "" }, preferredTenantType: { type: String, default: "" }, subLeasingAllowed: { type: Boolean }, registrationStampDutyResponsibility: { type: String, default: "" }, contactType: { type: String, default: "" },
    },
    area: { type: String, default: "" },
    projectArea: { type: projectAreaSchema, default: undefined },
    totalUnits: { type: Number, min: 1 },
    totalTowers: { type: Number, min: 1 },
    projectNarrative: { type: projectNarrativeSchema, default: undefined },
    masterPlan: { type: masterPlanSchema, default: undefined },
    projectDownloads: { type: [projectDownloadSchema], default: [] },
    walkthroughVideoUrl: { type: String, default: "", trim: true, maxlength: 500 },
    faqs: { type: [projectFaqSchema], default: [] },
    possession: { type: String, default: "" },
    possessionDetails: { type: possessionDetailsSchema, default: undefined },
    builder: { type: String, default: "" },
    developerLogoUrl: { type: String, default: "", trim: true },
    developerDescription: { type: String, default: "", trim: true, maxlength: 5000 },
    localityMapImageUrl: { type: String, default: "", trim: true },
    image: { type: String, default: "" },
    badges: [{ type: String }],
    
    // Which homepage carousel/section this belongs to
    websiteSection: { 
      type: String, 
      enum: ["Handpicked", "Newly Launched", "Search Trends", "Offers", "Featured", "Recommended Insights", "None"], 
      default: "None" 
    },
    homepageSections: {
      type: [{
        type: String,
        enum: ["Recommended", "Handpicked", "Newly Launched", "Search Trends", "Offers", "Newly Listed", "Featured"],
      }],
      default: [],
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
    bulkImport: {
      packageKey: { type: String, trim: true, maxlength: 600 },
      packageName: { type: String, trim: true, maxlength: 300 },
      packageSize: { type: Number, min: 0 },
      batchName: { type: String, trim: true, maxlength: 300 },
      batchKey: { type: String, trim: true, maxlength: 300 },
      importState: { type: String, enum: ["uploading", "complete", "failed"], default: "complete" },
      importError: { type: String, trim: true, maxlength: 2000 },
      importedAt: { type: Date },
    },
    ageOfProperty: { type: String, default: "" },
    heroImages: {
      type: [{ type: String, trim: true }],
      validate: {
        validator: (images) => !images || images.length <= 3,
        message: "Project overview supports a maximum of 3 main photos",
      },
    },
    heroVideo: { type: String, default: "", trim: true },
    images: [{ type: String }],
    // Permanent ownership ledger. Removing a photo from a visible gallery does
    // not remove it from storage; the ledger is cleaned only with the project.
    mediaAssets: [{ type: String, trim: true }],
    videos: [{ type: String }],
    brochure: { type: String, default: "" },
    brochureName: { type: String, default: "" },
    virtualTourUrl: { type: String, default: "", trim: true },
    amenities: [{ type: String }],
    facilities: { type: [facilityDetailSchema], default: undefined },
    overlooking: [{ type: String, trim: true }],
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
      address: { type: String, default: "", trim: true },
      landmark: { type: String, default: "" },
      pinCode: { type: String, default: "", trim: true },
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 },
    },
    locationVerification: { type: locationVerificationSchema, default: undefined },

    nearbyAmenities: {
      schools: { type: String, default: "" },
      colleges: { type: String, default: "" },
      hospitals: { type: String, default: "" },
      shopping: { type: String, default: "" },
      metro: { type: String, default: "" },
      workplaces: { type: String, default: "" },
      parks: { type: String, default: "" },
      roads: { type: String, default: "" },
    },

    nearbyDetails: {
      schools: { type: nearbyDetailSchema, default: undefined },
      colleges: { type: nearbyDetailSchema, default: undefined },
      hospitals: { type: nearbyDetailSchema, default: undefined },
      shopping: { type: nearbyDetailSchema, default: undefined },
      metro: { type: nearbyDetailSchema, default: undefined },
      workplaces: { type: nearbyDetailSchema, default: undefined },
      parks: { type: nearbyDetailSchema, default: undefined },
      roads: { type: nearbyDetailSchema, default: undefined },
    },

    reraRegistered: { type: Boolean, default: false },
    reraNumber: { type: String, default: "", trim: true },
    reraPhases: { type: [reraPhaseSchema], default: [] },
    verified: { type: Boolean, default: false },
    published: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["draft", "submitted", "under_review", "changes_requested", "resubmitted", "published", "rejected", "pending", "recheck", "approved"],
      default: "approved",
    },
    reviewMessages: { type: [reviewMessageSchema], default: [] },
    workflowHistory: { type: [propertyWorkflowHistorySchema], default: [] },
    submissionVersion: { type: Number, min: 1, default: 1 },
    lastSubmittedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: "", trim: true },
    featured: { type: Boolean, default: false },
    postedDate: { type: String, default: () => new Date().toISOString() },

    // Who posted this property
    postedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    propertyPoster: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PropertyPosterAccount",
      default: null,
    },
    submissionProfile: { type: propertySubmissionProfileSchema, default: undefined },

    // Relational links set by an admin (null = unlinked; falls back to free-text `builder` / dealer heuristics)
    builderId: { type: mongoose.Schema.Types.ObjectId, ref: "Builder", default: null },
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
// Makes browser batch retries idempotent without affecting ordinary listings.
propertySchema.index({ "bulkImport.packageKey": 1 }, { unique: true, sparse: true });
// Relational link lookups + unset cascade (see propertyLinkSync)
propertySchema.index({ builderId: 1 });
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
