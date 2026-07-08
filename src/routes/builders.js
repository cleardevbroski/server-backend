const express = require("express");
const { body, validationResult } = require("express-validator");
const Builder = require("../models/Builder");
const { unsetBuilderRef } = require("../services/propertyLinkSync");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const { uploadIfBase64 } = require("../utils/mediaUpload");

const router = express.Router();

// Escape regex metacharacters to prevent ReDoS (CR005)
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SORT_ALIASES = { "-projects": "-projectCount", projects: "projectCount" };

// GET /api/builders
router.get("/", async (req, res) => {
  try {
    const { page = 1, limit = 20, city, featured, verified, search, sort = "-createdAt" } = req.query;

    const filter = {};
    if (city) filter.city = new RegExp(escapeRegex(String(city)), "i");
    if (featured !== undefined) filter.featured = featured === "true";
    if (verified !== undefined) filter.verified = verified === "true";
    if (search) filter.name = new RegExp(escapeRegex(String(search)), "i");
    if (req.query.status) filter.status = String(req.query.status);

    const limitNum = Math.min(Math.max(parseInt(limit) || 20, 1), 100);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const skip = (pageNum - 1) * limitNum;
    const resolvedSort = SORT_ALIASES[sort] || sort;

    const [builders, total] = await Promise.all([
      Builder.find(filter).sort(resolvedSort).skip(skip).limit(limitNum).lean(),
      Builder.countDocuments(filter),
    ]);

    const mapped = builders.map((b) => ({ ...b, id: b._id.toString() }));

    return res.json({
      builders: mapped,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    console.error("List builders error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/builders/:slug
router.get("/:slug", async (req, res) => {
  try {
    const builder = await Builder.findOne({ slug: req.params.slug }).lean();
    if (!builder) {
      return res.status(404).json({ error: "Builder not found" });
    }
    return res.json({ builder: { ...builder, id: builder._id.toString() } });
  } catch (error) {
    console.error("Get builder error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/builders (admin only)
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

      const builder = await Builder.create({
        ...req.body,
        logo: await uploadIfBase64(req.body.logo, { resourceType: "image", folder: "clear-title/builders" }),
      });

      return res.status(201).json({
        message: "Builder created successfully",
        builder: { ...builder.toObject(), id: builder._id.toString() },
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({ error: "Slug already in use" });
      }
      console.error("Create builder error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// PUT /api/builders/:id (admin only)
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

      const builder = await Builder.findByIdAndUpdate(
        req.params.id,
        {
          ...req.body,
          logo: await uploadIfBase64(req.body.logo, { resourceType: "image", folder: "clear-title/builders" }),
        },
        { new: true, runValidators: true }
      );

      if (!builder) {
        return res.status(404).json({ error: "Builder not found" });
      }

      return res.json({
        message: "Builder updated successfully",
        builder: { ...builder.toObject(), id: builder._id.toString() },
      });
    } catch (error) {
      if (error.name === "CastError") {
        return res.status(404).json({ error: "Builder not found" });
      }
      if (error.code === 11000) {
        return res.status(400).json({ error: "Slug already in use" });
      }
      console.error("Update builder error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// PATCH /api/builders/:id/verify (admin only)
router.patch("/:id/verify", auth, adminOnly, async (req, res) => {
  try {
    const builder = await Builder.findById(req.params.id);
    if (!builder) {
      return res.status(404).json({ error: "Builder not found" });
    }
    builder.verified = !builder.verified;
    await builder.save();
    return res.json({
      message: "Builder verification toggled",
      builder: { ...builder.toObject(), id: builder._id.toString() },
    });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(404).json({ error: "Builder not found" });
    }
    console.error("Toggle builder verification error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/builders/:id (admin only)
router.delete("/:id", auth, adminOnly, async (req, res) => {
  try {
    const builder = await Builder.findByIdAndDelete(req.params.id);
    if (!builder) {
      return res.status(404).json({ error: "Builder not found" });
    }
    await unsetBuilderRef(builder._id);
    return res.json({ message: "Builder deleted successfully" });
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(404).json({ error: "Builder not found" });
    }
    console.error("Delete builder error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
