const express = require("express");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const { resolveNearbyPlace } = require("../services/nominatimService");
const {
  ProjectLocationVerificationError,
  analyzeProjectLocation,
  confirmProjectLocation,
} = require("../services/projectLocationVerification");

const router = express.Router();

router.post("/nearby-place", auth, async (req, res) => {
  const query = String(req.body?.query || "").trim();
  const latitude = Number(req.body?.latitude);
  const longitude = Number(req.body?.longitude);
  if (!query) return res.status(400).json({ error: "Enter the nearby place name first." });
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return res.status(400).json({ error: "Enter valid property latitude and longitude first." });
  }

  try {
    const place = await resolveNearbyPlace({ query, latitude, longitude });
    if (!place) return res.status(404).json({ error: "No matching place was found. Add more address detail and retry." });
    return res.json({ place });
  } catch (error) {
    console.error("Nearby-place geocoding failed:", error.message);
    return res.status(502).json({ error: "The map service could not resolve this place right now. Please retry." });
  }
});

router.post("/project-location/analyze", auth, adminOnly, async (req, res) => {
  try {
    const locality = req.body?.locality && typeof req.body.locality === "object" ? {
      address: String(req.body.locality.address || "").slice(0, 2000),
      landmark: String(req.body.locality.landmark || "").slice(0, 500),
      city: String(req.body.locality.city || "").slice(0, 200),
      pinCode: String(req.body.locality.pinCode || "").slice(0, 20),
    } : {};
    const reraAddresses = Array.isArray(req.body?.reraAddresses)
      ? req.body.reraAddresses.map((value) => String(value || "").slice(0, 2000)).slice(0, 20)
      : [];
    const analysis = await analyzeProjectLocation({
      geocode: String(req.body?.geocode || "").slice(0, 2000),
      latitude: req.body?.latitude,
      longitude: req.body?.longitude,
      locality,
      reraAddresses,
    });
    return res.json({ analysis });
  } catch (error) {
    if (error instanceof ProjectLocationVerificationError) return res.status(error.status).json({ error: error.message });
    console.error("Project-location analysis failed:", error.message);
    return res.status(502).json({ error: "The map service could not analyze this project location right now. Please retry." });
  }
});

router.post("/project-location/confirm", auth, adminOnly, async (req, res) => {
  try {
    const verification = confirmProjectLocation(req.body?.analysis, req.user);
    return res.json({ verification });
  } catch (error) {
    if (error instanceof ProjectLocationVerificationError) return res.status(error.status).json({ error: error.message });
    console.error("Project-location confirmation failed:", error.message);
    return res.status(500).json({ error: "Could not confirm this project location." });
  }
});

module.exports = router;
