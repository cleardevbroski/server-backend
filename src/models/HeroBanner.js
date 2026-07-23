const mongoose = require("mongoose");

const extraDetailSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    value: { type: String, required: true, trim: true, maxlength: 500 },
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const heroBannerSchema = new mongoose.Schema(
  {
    image: { type: String, required: true },
    logo: { type: String, default: "" },
    builderName: { type: String, default: "" },
    title: { type: String, required: true, trim: true },
    tagline: { type: String, default: "" },
    location: { type: String, default: "" },
    priceText: { type: String, default: "" },
    rera: { type: String, default: "" },
    badge: { type: String, default: "" },
    ctaText: { type: String, default: "" },
    linkType: { type: String, enum: ["property", "builder", "custom"], default: "custom" },
    linkValue: { type: String, default: "" },
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: "Property", default: null, index: true },
    promotionSlot: {
      type: String,
      enum: ["diamond", "gold", "silver"],
      default: undefined,
      index: true,
    },
    displayOnHomepage: { type: Boolean, default: true },
    selectedFields: [{ type: String, trim: true }],
    fieldOverrides: { type: Map, of: String, default: {} },
    extraDetails: { type: [extraDetailSchema], default: [] },
    additionalInformation: {
      enabled: { type: Boolean, default: false },
      values: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    order: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("HeroBanner", heroBannerSchema);
