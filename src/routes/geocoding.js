const express = require("express");
const auth = require("../middleware/auth");
const { resolveNearbyPlace } = require("../services/nominatimService");

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

module.exports = router;
