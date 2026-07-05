const express = require("express");
const { body, validationResult } = require("express-validator");
const HeroBanner = require("../models/HeroBanner");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");

const router = express.Router();

// GET /api/hero/banners (public — published only)
router.get("/banners", async (req, res) => {
  try {
    const banners = await HeroBanner.find({ published: true }).sort("order").lean();
    const mapped = banners.map((b) => ({ ...b, id: b._id.toString() }));
    return res.json({ banners: mapped });
  } catch (error) {
    console.error("List hero banners error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/hero/banners (admin only)
router.post(
  "/banners",
  auth,
  adminOnly,
  [
    body("image").trim().notEmpty().withMessage("Image is required"),
    body("title").trim().notEmpty().withMessage("Title is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }
      const banner = await HeroBanner.create(req.body);
      return res.status(201).json({
        message: "Hero banner created successfully",
        banner: { ...banner.toObject(), id: banner._id.toString() },
      });
    } catch (error) {
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
  [body("title").optional().trim().notEmpty().withMessage("Title cannot be empty")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }
      const banner = await HeroBanner.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });
      if (!banner) {
        return res.status(404).json({ error: "Hero banner not found" });
      }
      return res.json({
        message: "Hero banner updated successfully",
        banner: { ...banner.toObject(), id: banner._id.toString() },
      });
    } catch (error) {
      if (error.name === "CastError") {
        return res.status(404).json({ error: "Hero banner not found" });
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
        banner: { ...banner.toObject(), id: banner._id.toString() },
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
