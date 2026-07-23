const express = require("express");
const { body, validationResult } = require("express-validator");
const Advertisement = require("../models/Advertisement");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const { uploadIfBase64 } = require("../utils/mediaUpload");

const router = express.Router();
const mapAd = (ad) => ({ ...ad.toObject(), id: ad._id.toString() });

router.get("/", async (_req, res) => {
  try {
    const ads = await Advertisement.find({ active: true }).sort({ placement: 1, order: 1, createdAt: -1 });
    return res.json({ advertisements: ads.map(mapAd) });
  } catch (error) {
    console.error("List advertisements error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin", auth, adminOnly, async (_req, res) => {
  try {
    const ads = await Advertisement.find().sort({ placement: 1, order: 1, createdAt: -1 });
    return res.json({ advertisements: ads.map(mapAd) });
  } catch (error) {
    console.error("List admin advertisements error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", auth, adminOnly, [
  body("image").trim().notEmpty().withMessage("Advertisement image is required"),
  body("placement").isIn(["left", "right"]).withMessage("Placement must be left or right"),
  body("link").optional({ values: "falsy" }).isURL({ protocols: ["http", "https"], require_protocol: true }).withMessage("Link must be a valid HTTP(S) URL"),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    const ad = await Advertisement.create({
      ...req.body,
      image: await uploadIfBase64(req.body.image, { resourceType: "image", folder: "clear-title/advertisements" }),
    });
    return res.status(201).json({ message: "Advertisement created", advertisement: mapAd(ad) });
  } catch (error) {
    console.error("Create advertisement error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", auth, adminOnly, [
  body("placement").optional().isIn(["left", "right"]).withMessage("Placement must be left or right"),
  body("link").optional({ values: "falsy" }).isURL({ protocols: ["http", "https"], require_protocol: true }).withMessage("Link must be a valid HTTP(S) URL"),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    const updates = { ...req.body };
    if (updates.image) updates.image = await uploadIfBase64(updates.image, { resourceType: "image", folder: "clear-title/advertisements" });
    const ad = await Advertisement.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!ad) return res.status(404).json({ error: "Advertisement not found" });
    return res.json({ message: "Advertisement updated", advertisement: mapAd(ad) });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Advertisement not found" });
    console.error("Update advertisement error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", auth, adminOnly, async (req, res) => {
  try {
    const ad = await Advertisement.findByIdAndDelete(req.params.id);
    if (!ad) return res.status(404).json({ error: "Advertisement not found" });
    return res.json({ message: "Advertisement deleted" });
  } catch (error) {
    if (error.name === "CastError") return res.status(404).json({ error: "Advertisement not found" });
    console.error("Delete advertisement error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
