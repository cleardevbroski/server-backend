const express = require("express");
const rateLimit = require("express-rate-limit");
const Property = require("../models/Property");
const { affordabilityForProperty, getSettings, principalFromEmi, propertyConfigurations } = require("../services/affordabilityService");
const { distanceMeters, searchLocation } = require("../services/nominatimService");

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: "Too many home searches. Please try again shortly." } });

function validNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function deadlineDate(value) {
  if (!value) return null;
  const date = new Date(/^\d{4}-\d{2}$/.test(String(value)) ? `${value}-01T00:00:00.000Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function projectPossessionDate(property) {
  return deadlineDate(property.possessionDetails?.expectedCompletionDate || property.possessionDetails?.launchDate || property.possession);
}

function verifiedCoordinates(property) {
  const latitude = Number(property.locality?.latitude);
  const longitude = Number(property.locality?.longitude);
  const verification = property.locationVerification;
  return Number.isFinite(latitude) && Number.isFinite(longitude) && verification?.status === "admin_verified"
    ? { latitude, longitude }
    : null;
}

function reraDocumentCount(property) {
  return (property.reraPhases || []).reduce((total, phase) => total + (phase.reraDocuments || []).length + (phase.projectDocuments || []).length, 0);
}

router.post("/destination", limiter, async (req, res) => {
  const query = String(req.body?.query || "").trim().slice(0, 300);
  if (query.length < 3) return res.status(400).json({ error: "Enter a more complete destination" });
  try {
    const destination = await searchLocation(query);
    if (!destination) return res.status(404).json({ error: "Destination could not be located. Add an area and city." });
    return res.json({ destination });
  } catch (error) {
    console.error("Buyer destination resolution error:", error.message);
    return res.status(502).json({ error: "The location service is temporarily unavailable. You can continue without distance ranking." });
  }
});

router.post("/recommendations", limiter, async (req, res) => {
  try {
    const purpose = ["self_use", "family_upgrade", "investment", "rental"].includes(req.body?.purpose) ? req.body.purpose : null;
    const maxEmi = validNumber(req.body?.maxMonthlyEmi, 1000, 10_000_000);
    const downPayment = validNumber(req.body?.downPayment, 0, 1_000_000_000);
    const bhk = validNumber(req.body?.bhk, 1, 20);
    const deadline = deadlineDate(req.body?.deadline);
    if (!purpose || maxEmi == null || downPayment == null || !Number.isInteger(bhk) || !deadline) {
      return res.status(400).json({ error: "Complete all six home-search questions with valid values" });
    }
    const destination = req.body?.destination && Number.isFinite(Number(req.body.destination.latitude)) && Number.isFinite(Number(req.body.destination.longitude)) ? {
      query: String(req.body.destination.query || "").trim().slice(0, 300),
      resolvedAddress: String(req.body.destination.resolvedAddress || "").trim().slice(0, 1000),
      latitude: Number(req.body.destination.latitude),
      longitude: Number(req.body.destination.longitude),
    } : { query: String(req.body?.destination?.query || "").trim().slice(0, 300) };
    if (!destination.query) return res.status(400).json({ error: "Enter your workplace or important destination" });

    const settings = await getSettings();
    const interestRate = validNumber(req.body?.interestRate, 0, 50) ?? Number(settings.defaultInterestRate);
    const tenureYears = validNumber(req.body?.tenureYears, 1, 40) ?? Number(settings.defaultTenureYears);
    const estimatedLoan = principalFromEmi(maxEmi, interestRate, tenureYears);
    const estimatedFunds = estimatedLoan + downPayment;
    const properties = await Property.find({
      propertyType: { $in: ["Apartment", "Villa"] },
      listingType: { $ne: "For Rent" },
      $or: [{ status: { $in: ["approved", "published"] } }, { status: { $exists: false }, published: { $ne: false } }],
      $and: [{ $or: [
        { bedrooms: bhk },
        { configurationDetails: { $elemMatch: { bedrooms: bhk } } },
        { "villaDetails.configurationDetails": { $elemMatch: { bedrooms: bhk } } },
      ] }],
    }).limit(150).lean();

    const candidates = [];
    for (const property of properties) {
      const configurations = propertyConfigurations(property).filter((row) => Number(row.bedrooms) === bhk && row.price);
      for (const configuration of configurations) {
        const affordability = await affordabilityForProperty(property, {
          configurationName: configuration.name,
          loanAmount: Math.min(estimatedLoan, estimatedFunds),
          interestRate,
          tenureYears,
        });
        if (!affordability.available) continue;
        const possessionDate = projectPossessionDate(property);
        const possessionMatches = !possessionDate || possessionDate <= deadline;
        const budgetRatio = affordability.totalPurchaseCost / estimatedFunds;
        if (budgetRatio > 1.15) continue;
        const coordinates = verifiedCoordinates(property);
        const distanceKm = coordinates && Number.isFinite(destination.latitude) ? distanceMeters(coordinates.latitude, coordinates.longitude, destination.latitude, destination.longitude) / 1000 : null;
        let score = 20;
        score += budgetRatio <= 1 ? Math.max(12, 35 - budgetRatio * 15) : Math.max(0, 12 - (budgetRatio - 1) * 80);
        score += possessionMatches ? 20 : 0;
        score += distanceKm == null ? 5 : Math.max(0, 15 - distanceKm * 0.5);
        const hasRera = Boolean(property.reraRegistered && property.reraPhases?.length);
        const documents = reraDocumentCount(property);
        score += hasRera ? 5 : 0;
        score += documents > 0 ? 5 : 0;
        const purposeReason = purpose === "investment"
          ? "Investment ranking uses budget, RERA and document completeness—not promised returns"
          : purpose === "rental"
            ? "Rental-purpose ranking uses affordability and location only; rental income is not assumed"
            : purpose === "family_upgrade"
              ? "Family-upgrade ranking prioritizes configuration, possession and daily travel"
              : "Self-use ranking prioritizes affordability, possession and daily travel";
        if (purpose === "investment" && hasRera && documents > 0) score += 4;
        if (purpose === "rental" && distanceKm != null && distanceKm <= 15) score += 4;
        const reasons = [
          purposeReason,
          budgetRatio <= 1 ? "Within your estimated total budget" : `About ${Math.round((budgetRatio - 1) * 100)}% above your estimated budget`,
          `${bhk} BHK configuration available`,
          possessionMatches ? "Possession matches your deadline" : "Possession date needs review against your deadline",
          distanceKm == null ? "Commute distance unavailable until both locations are verified" : `Approximately ${distanceKm.toFixed(1)} km straight-line distance from your destination`,
          coordinates ? "Verified project location" : "Project coordinates are not verified",
          documents > 0 ? "RERA or project documents available" : hasRera ? "RERA registered; uploaded documents not available" : "RERA information not available",
        ];
        candidates.push({ property, configuration, affordability, distanceKm, possessionMatches, score: Math.round(Math.max(0, Math.min(100, score))), reasons });
      }
    }
    candidates.sort((left, right) => right.score - left.score || left.affordability.totalPurchaseCost - right.affordability.totalPurchaseCost);
    const seen = new Set();
    const recommendations = candidates.filter((candidate) => {
      const id = String(candidate.property._id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }).slice(0, 10).map((candidate, index) => ({
      rank: index + 1,
      score: candidate.score,
      reasons: candidate.reasons,
      distanceKm: candidate.distanceKm == null ? null : Number(candidate.distanceKm.toFixed(1)),
      configuration: { name: candidate.configuration.name, bedrooms: candidate.configuration.bedrooms, price: candidate.configuration.price, area: candidate.configuration.area },
      affordability: candidate.affordability,
      property: { ...candidate.property, id: String(candidate.property._id) },
    }));
    return res.json({
      recommendations,
      calculation: { maxMonthlyEmi: maxEmi, downPayment, estimatedLoan: Math.round(estimatedLoan), estimatedFunds: Math.round(estimatedFunds), interestRate, tenureYears, disclaimer: settings.disclaimer },
      destination,
      searchedCount: properties.length,
    });
  } catch (error) {
    console.error("Find My Home recommendations error:", error);
    return res.status(500).json({ error: "Unable to prepare home recommendations" });
  }
});

module.exports = router;
