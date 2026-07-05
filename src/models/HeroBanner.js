const mongoose = require("mongoose");

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
    order: { type: Number, default: 0 },
    published: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("HeroBanner", heroBannerSchema);
