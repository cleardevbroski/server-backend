const express = require("express");
const { body, validationResult } = require("express-validator");
const Dealer = require("../models/Dealer");
const { unsetDealerRef } = require("../services/propertyLinkSync");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");

const router = express.Router();

// Escape regex metacharacters to prevent ReDoS (CR005)
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET /api/dealers
router.get("/", async (req, res) => {
  try {
    const { page = 1, limit = 20, sort = "-createdAt", city, featured, verified, search } = req.query;

    const filter = {};
    if (city) filter.city = new RegExp(escapeRegex(String(city)), "i");
    if (featured !== undefined) filter.featured = featured === "true";
    if (verified !== undefined) filter.verified = verified === "true";
    if (search) filter.$or = [{ name: new RegExp(escapeRegex(String(search)), "i") }, { agency: new RegExp(escapeRegex(String(search)), "i") }];
    if (req.query.status) filter.status = String(req.query.status);

    const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const skip = (pageNum - 1) * limitNum;

    const [dealers, total] = await Promise.all([
      Dealer.find(filter).sort(sort).skip(skip).limit(limitNum).lean(),
      Dealer.countDocuments(filter),
    ]);

    const mapped = dealers.map((d) => ({ ...d, id: d._id.toString() }));

    return res.json({
      dealers: mapped,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("List dealers error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/dealers/:slug
router.get("/:slug", async (req, res) => {
  try {
    const dealer = await Dealer.findOne({ slug: req.params.slug }).lean();
    if (!dealer) {
      return res.status(404).json({ error: "Dealer not found" });
    }
    return res.json({ dealer: { ...dealer, id: dealer._id.toString() } });
  } catch (error) {
    console.error("Get dealer error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/dealers (admin only)
router.post(
  "/",
  auth,
  adminOnly,
  [
    body("name").trim().notEmpty().withMessage("Name is required"),
    body("slug").trim().notEmpty().withMessage("Slug is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const dealer = await Dealer.create(req.body);

      return res.status(201).json({
        message: "Dealer created successfully",
        dealer: { ...dealer.toObject(), id: dealer._id.toString() },
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({ error: "Slug already in use" });
      }
      console.error("Create dealer error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// PUT /api/dealers/:id (admin only)
router.put(
  "/:id",
  auth,
  adminOnly,
  [body("name").optional().trim().notEmpty().withMessage("Name cannot be empty")],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const dealer = await Dealer.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true,
      });

      if (!dealer) {
        return res.status(404).json({ error: "Dealer not found" });
      }

      return res.json({
        message: "Dealer updated successfully",
        dealer: { ...dealer.toObject(), id: dealer._id.toString() },
      });
    } catch (error) {
      if (error.name === "CastError") {
        return res.status(404).json({ error: "Dealer not found" });
      }
      if (error.code === 11000) {
        return res.status(400).json({ error: "Slug already in use" });
      }
      console.error("Update dealer error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// PATCH /api/dealers/:id/verify (admin only)
router.patch("/:id/verify", auth, adminOnly, async (req, res) => {
  try {
    const dealer = await Dealer.findById(req.params.id);
    if (!dealer) {
      return res.status(404).json({ error: "Dealer not found" });
    }
    dealer.verified = !dealer.verified;
    await dealer.save();
    return res.json({
      message: "Dealer verification toggled",
      dealer: { ...dealer.toObject(), id: dealer._id.toString() },
    });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(404).json({ error: "Dealer not found" });
    }
    console.error("Toggle dealer verification error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/dealers/:id (admin only)
router.delete("/:id", auth, adminOnly, async (req, res) => {
  try {
    const dealer = await Dealer.findByIdAndDelete(req.params.id);
    if (!dealer) {
      return res.status(404).json({ error: "Dealer not found" });
    }
    await unsetDealerRef(dealer._id);
    return res.json({ message: "Dealer deleted successfully" });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(404).json({ error: "Dealer not found" });
    }
    console.error("Delete dealer error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
