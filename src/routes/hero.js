const express = require("express");
const { body, validationResult } = require("express-validator");
const HeroBanner = require("../models/HeroBanner");
const Property = require("../models/Property");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const { uploadIfBase64 } = require("../utils/mediaUpload");

const router = express.Router();

const PROMOTION_RANK = { diamond: 1, gold: 2, silver: 3 };
const HERO_FIELDS = [
  "title", "builder", "location", "price", "propertyType", "possession", "reraNumber", "area",
  "configuration", "facing", "furnishing", "parking", "bedrooms", "bathrooms",
  "structure", "amenities", "society", "locality",
];

function promotionRank(slot) {
  return PROMOTION_RANK[slot] || null;
}

function presentBanner(banner) {
  const source = typeof banner.toObject === "function" ? banner.toObject() : banner;
  return {
    ...source,
    id: source._id.toString(),
    propertyId: source.propertyId?._id?.toString?.() || source.propertyId?.toString?.() || null,
    promotionSlot: source.promotionSlot || null,
    rank: promotionRank(source.promotionSlot),
    fieldOverrides: source.fieldOverrides instanceof Map
      ? Object.fromEntries(source.fieldOverrides)
      : source.fieldOverrides || {},
  };
}

function overrideValue(overrides, key, fallback = "") {
  const value = overrides instanceof Map ? overrides.get(key) : overrides?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isPublishedProperty(property) {
  return property
    && property.published !== false
    && (!property.status || ["approved", "published"].includes(property.status));
}

function propertyDefaults(property) {
  if (!property) return {};
  const propertyId = property._id.toString();
  return {
    image: property.heroImages?.[0] || property.image || "",
    builderName: property.builder || "",
    title: property.title || "",
    location: property.subtitle || [property.locality?.landmark, property.locality?.city].filter(Boolean).join(", "),
    priceText: propertyHeroPrice(property),
    rera: property.reraNumber || "",
    badge: property.badges?.[0] || "Featured",
    ctaText: "Explore Now",
    linkType: "property",
    linkValue: propertyId,
  };
}

function formatRupees(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? `₹${amount.toLocaleString("en-IN")}` : "";
}

function propertyHeroPrice(property) {
  if (property?.price) return property.price;
  if (property?.propertyType === "PG/Co-living") {
    const rents = (property.pgDetails?.sharingDetails || []).map((item) => Number(item.rentPerBed)).filter((value) => Number.isFinite(value) && value > 0);
    if (rents.length) return `${formatRupees(Math.min(...rents))} / month`;
  }
  if (property?.propertyType === "Plot") {
    const prices = (property.plotDetails?.plotSizeDetails || []).map((item) => Number(item.totalPrice)).filter((value) => Number.isFinite(value) && value > 0);
    if (prices.length) return `From ${formatRupees(Math.min(...prices))}`;
  }
  return "";
}

function propertyHeroArea(property) {
  if (property?.area) return property.area;
  if (property?.propertyType === "Villa") {
    const row = property.villaDetails?.configurationDetails?.[0];
    return row?.superArea || row?.builtUpArea || row?.plotArea || "";
  }
  if (property?.propertyType === "Plot") {
    return property.plotDetails?.plotSizeDetails?.map((item) => item.plotSize || (item.areaSqft ? `${item.areaSqft} sq.ft.` : "")).filter(Boolean).join(", ") || "";
  }
  if (property?.propertyType === "Commercial") {
    return property.commercialDetails?.superArea || property.commercialDetails?.builtUpArea || property.commercialDetails?.carpetArea || "";
  }
  return "";
}

function propertyStructure(property) {
  if (!property) return "";
  if (property.propertyType === "Villa" && property.villaDetails) {
    return [property.villaDetails.villaType, property.villaDetails.plotDimensions, property.villaDetails.numberOfFloors && `${property.villaDetails.numberOfFloors} floors`].filter(Boolean).join(" · ");
  }
  if (property.propertyType === "Plot" && property.plotDetails) {
    return [
      property.plotDetails.plotSizeDetails?.map((item) => item.plotSize).filter(Boolean).join(", "),
      property.plotDetails.totalPlots && `${property.plotDetails.totalPlots} plots`,
      property.plotDetails.approvalAuthority,
    ].filter(Boolean).join(" · ");
  }
  if (property.propertyType === "Commercial" && property.commercialDetails) {
    return [property.commercialDetails.commercialSubtype, property.commercialDetails.buildingGrade, property.commercialDetails.structure].filter(Boolean).join(" · ");
  }
  if (property.propertyType === "PG/Co-living" && property.pgDetails) {
    return [
      property.pgDetails.sharingDetails?.map((item) => item.sharingType).filter(Boolean).join(", "),
      property.pgDetails.genderPreference,
      property.pgDetails.mealsIncluded,
      property.pgDetails.contactType,
    ].filter(Boolean).join(" · ");
  }
  return [property.propertyType === "Apartment" ? "" : property.floor, property.totalFloors && `${property.totalFloors} total floors`].filter(Boolean).join(" · ");
}

function resolvePromotionBanner(banner, property) {
  const overrides = banner.fieldOverrides || {};
  const configuration = property.configs?.join(", ")
    || property.configurationDetails?.map((item) => item.configuration).join(", ")
    || property.villaDetails?.configurationDetails?.map((item) => item.configuration).join(", ")
    || property.rentDetails?.configuration
    || property.pgDetails?.sharingDetails?.map((item) => item.sharingType).filter(Boolean).join(", ")
    || "";
  return {
    ...banner,
    image: banner.image || property.heroImages?.[0] || property.image || "",
    title: overrideValue(overrides, "title", property.title || ""),
    builderName: overrideValue(overrides, "builder", property.builder || ""),
    location: overrideValue(overrides, "location", property.subtitle || ""),
    priceText: overrideValue(overrides, "price", propertyHeroPrice(property)),
    rera: overrideValue(overrides, "reraNumber", property.reraNumber || ""),
    linkType: "property",
    linkValue: property._id.toString(),
    resolvedDetails: {
      propertyType: overrideValue(overrides, "propertyType", property.propertyType || ""),
      possession: overrideValue(overrides, "possession", property.possessionDetails?.status || property.possession || ""),
      area: overrideValue(overrides, "area", propertyHeroArea(property)),
      configuration: overrideValue(overrides, "configuration", configuration),
      structure: overrideValue(overrides, "structure", propertyStructure(property)),
      amenities: overrideValue(overrides, "amenities", property.amenities?.join(", ") || ""),
    },
  };
}

function normalizeExtraDetails(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Extra details must be an array");
  return value.map((detail, index) => {
    const label = String(detail?.label || "").trim();
    const detailValue = String(detail?.value || "").trim();
    if (!label || !detailValue) throw new Error("Every extra detail requires a label and value");
    return {
      id: String(detail.id || `extra-${Date.now()}-${index}`).trim(),
      label,
      value: detailValue,
      enabled: detail.enabled !== false,
      order: Number.isInteger(Number(detail.order)) && Number(detail.order) >= 0 ? Number(detail.order) : index,
    };
  }).sort((a, b) => a.order - b.order);
}

function normalizeSelectedFields(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Selected fields must be an array");
  return [...new Set(value.map((field) => String(field).trim()).filter((field) => HERO_FIELDS.includes(field)))];
}

function normalizeFieldOverrides(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Field overrides must be an object");
  return Object.fromEntries(
    Object.entries(value)
      .filter(([field]) => HERO_FIELDS.includes(field))
      .map(([field, fieldValue]) => [field, String(fieldValue ?? "").trim()])
  );
}

function normalizeAdditionalInformation(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Additional information must be an object");
  }
  return {
    enabled: Boolean(value.enabled),
    values: value.values && typeof value.values === "object" && !Array.isArray(value.values) ? value.values : {},
  };
}

async function validatePromotionAssignment({ promotionSlot, propertyId, bannerId }) {
  if (!promotionSlot) return;
  if (!PROMOTION_RANK[promotionSlot]) {
    const error = new Error("Promotion slot must be diamond, gold or silver");
    error.status = 400;
    throw error;
  }
  const exclusion = bannerId ? { _id: { $ne: bannerId } } : {};
  const occupied = await HeroBanner.findOne({ promotionSlot, ...exclusion }).lean();
  if (occupied) {
    const error = new Error(`The ${promotionSlot} promotion slot is already occupied`);
    error.status = 409;
    throw error;
  }
  if (propertyId) {
    const duplicateProperty = await HeroBanner.findOne({
      propertyId,
      promotionSlot: { $in: Object.keys(PROMOTION_RANK) },
      ...exclusion,
    }).lean();
    if (duplicateProperty) {
      const error = new Error("This property is already assigned to another promotion slot");
      error.status = 409;
      throw error;
    }
  }
}

async function prepareBannerInput(body, { partial = false, currentBanner = null } = {}) {
  const input = { ...body };
  let property = null;
  const effectiveSlot = body.promotionSlot !== undefined ? body.promotionSlot : currentBanner?.promotionSlot;
  const effectivePropertyId = body.propertyId !== undefined ? body.propertyId : currentBanner?.propertyId;

  if (effectiveSlot && !effectivePropertyId) {
    const error = new Error("A promotion slot requires a linked property");
    error.status = 400;
    throw error;
  }

  await validatePromotionAssignment({
    promotionSlot: effectiveSlot,
    propertyId: effectivePropertyId,
    bannerId: currentBanner?._id,
  });

  if (body.promotionSlot !== undefined) {
    input.promotionSlot = body.promotionSlot || undefined;
    if (input.promotionSlot) input.order = promotionRank(input.promotionSlot) - 1;
  }

  if (body.propertyId) {
    property = await Property.findById(body.propertyId).lean();
    if (!property) {
      const error = new Error("Property not found");
      error.status = 404;
      throw error;
    }
    if (!isPublishedProperty(property)) {
      const error = new Error("Only approved and published properties can be displayed on the homepage");
      error.status = 400;
      throw error;
    }
    if (!partial) Object.assign(input, propertyDefaults(property), body);
    input.propertyId = property._id;
    input.linkType = "property";
    input.linkValue = property._id.toString();
  } else if (body.propertyId === null || body.propertyId === "") {
    input.propertyId = null;
  }

  if (body.selectedFields !== undefined) input.selectedFields = normalizeSelectedFields(body.selectedFields);
  if (body.fieldOverrides !== undefined) input.fieldOverrides = normalizeFieldOverrides(body.fieldOverrides);
  if (body.extraDetails !== undefined) input.extraDetails = normalizeExtraDetails(body.extraDetails);
  if (body.additionalInformation !== undefined) input.additionalInformation = normalizeAdditionalInformation(body.additionalInformation);
  if (body.displayOnHomepage !== undefined) input.displayOnHomepage = Boolean(body.displayOnHomepage);
  if (body.published !== undefined) input.published = Boolean(body.published);
  if (body.order !== undefined) {
    const order = Number(body.order);
    if (!Number.isInteger(order)) throw new Error("Order must be an integer");
    input.order = order;
  }
  if (effectiveSlot) input.order = promotionRank(effectiveSlot) - 1;

  const image = input.image || propertyDefaults(property).image;
  if (!partial || image !== undefined) {
    input.image = await uploadIfBase64(image, { resourceType: "image", folder: "clear-title/hero" });
  }
  if (!partial || input.logo !== undefined) {
    input.logo = await uploadIfBase64(input.logo, { resourceType: "image", folder: "clear-title/hero" });
  }
  return input;
}

// GET /api/hero/banners (public — published only)
router.get("/banners", async (req, res) => {
  try {
    const activeBanners = await HeroBanner.find({ published: true, displayOnHomepage: { $ne: false } }).lean();
    const banners = activeBanners.sort((a, b) => {
      const orderDifference = (Number(a.order) || 0) - (Number(b.order) || 0);
      if (orderDifference) return orderDifference;
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });
    const propertyIds = banners.map((banner) => banner.propertyId).filter(Boolean);
    const properties = propertyIds.length
      ? await Property.find({ _id: { $in: propertyIds }, propertyType: { $nin: ["Rent", "Lease"] } }).lean()
      : [];
    const propertiesById = new Map(properties.map((property) => [property._id.toString(), property]));
    const mapped = banners
      .map((banner) => ({
        banner,
        property: banner.propertyId ? propertiesById.get(banner.propertyId.toString()) : null,
      }))
      .filter(({ banner, property }) => !banner.propertyId || isPublishedProperty(property))
      .map(({ banner, property }) => presentBanner(
        property
          ? resolvePromotionBanner(banner, property)
          : { ...propertyDefaults(property), ...banner }
      ));
    return res.json({ banners: mapped });
  } catch (error) {
    console.error("List hero banners error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/hero/banners/admin (admin only — includes hidden and unpublished)
router.get("/banners/admin", auth, adminOnly, async (req, res) => {
  try {
    const banners = await HeroBanner.find().sort("order").lean();
    return res.json({ banners: banners.map(presentBanner) });
  } catch (error) {
    console.error("List admin hero banners error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/hero/banners (admin only)
router.post(
  "/banners",
  auth,
  adminOnly,
  [
    body("image").optional().isString().withMessage("Image must be a string"),
    body("title").optional().isString().withMessage("Title must be a string"),
    body("propertyId").optional({ nullable: true }).isMongoId().withMessage("Property id is invalid"),
    body("promotionSlot").optional({ nullable: true }).isIn(["diamond", "gold", "silver"]).withMessage("Promotion slot is invalid"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }
      const input = await prepareBannerInput(req.body);
      if (!input.image || !input.title) {
        return res.status(400).json({ error: "Image and title are required" });
      }
      const banner = await HeroBanner.create(input);
      return res.status(201).json({
        message: "Hero banner created successfully",
        banner: presentBanner(banner),
      });
    } catch (error) {
      if (error.name === "CastError" || error.status === 404) return res.status(404).json({ error: "Property not found" });
      if (error.status === 409) return res.status(409).json({ error: error.message });
      if (error.status === 400 || error.message?.includes("requires") || error.message?.includes("must be")) {
        return res.status(400).json({ error: error.message });
      }
      console.error("Create hero banner error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// PUT /api/hero/banners/:id (admin only)
router.put(
  "/banners/:id",
  auth,
  adminOnly,
  [
    body("title").optional().trim().notEmpty().withMessage("Title cannot be empty"),
    body("propertyId").optional({ nullable: true }).isMongoId().withMessage("Property id is invalid"),
    body("promotionSlot").optional({ nullable: true }).isIn(["diamond", "gold", "silver"]).withMessage("Promotion slot is invalid"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }
      const currentBanner = await HeroBanner.findById(req.params.id).lean();
      if (!currentBanner) return res.status(404).json({ error: "Hero banner not found" });
      const input = await prepareBannerInput(req.body, { partial: true, currentBanner });
      const banner = await HeroBanner.findByIdAndUpdate(req.params.id, input, { new: true, runValidators: true });
      if (!banner) {
        return res.status(404).json({ error: "Hero banner not found" });
      }
      return res.json({
        message: "Hero banner updated successfully",
        banner: presentBanner(banner),
      });
    } catch (error) {
      if (error.status === 404) return res.status(404).json({ error: "Property not found" });
      if (error.name === "CastError") {
        return res.status(404).json({ error: "Hero banner not found" });
      }
      if (error.status === 409) return res.status(409).json({ error: error.message });
      if (error.status === 400 || error.message?.includes("requires") || error.message?.includes("must be")) {
        return res.status(400).json({ error: error.message });
      }
      console.error("Update hero banner error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// PATCH /api/hero/banners/:id/order (admin only)
router.patch(
  "/banners/:id/order",
  auth,
  adminOnly,
  [body("order").isInt().withMessage("Order must be an integer")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }
      const banner = await HeroBanner.findByIdAndUpdate(
        req.params.id,
        { order: req.body.order },
        { new: true, runValidators: true }
      );
      if (!banner) {
        return res.status(404).json({ error: "Hero banner not found" });
      }
      return res.json({
        message: "Hero banner order updated successfully",
        banner: presentBanner(banner),
      });
    } catch (error) {
      if (error.name === "CastError") {
        return res.status(404).json({ error: "Hero banner not found" });
      }
      console.error("Update hero banner order error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// DELETE /api/hero/banners/:id (admin only)
router.delete("/banners/:id", auth, adminOnly, async (req, res) => {
  try {
    const banner = await HeroBanner.findByIdAndDelete(req.params.id);
    if (!banner) {
      return res.status(404).json({ error: "Hero banner not found" });
    }
    return res.json({ message: "Hero banner deleted successfully" });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(404).json({ error: "Hero banner not found" });
    }
    console.error("Delete hero banner error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
