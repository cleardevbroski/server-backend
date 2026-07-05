const express = require("express");
const router = express.Router();
const Testimonial = require("../models/Testimonial");
const Lawyer = require("../models/Lawyer");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");

// ─── TESTIMONIALS ─────────────────────────────────────────────────────────

router.get("/testimonials", async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const testimonials = await Testimonial.find(filter).sort({ createdAt: -1 });
    res.json(testimonials);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch testimonials" });
  }
});

router.post("/testimonials", auth, adminOnly, async (req, res) => {
  try {
    const testimonial = new Testimonial(req.body);
    await testimonial.save();
    res.status(201).json(testimonial);
  } catch (error) {
    console.error("TESTIMONIAL ERROR:", error);
    res.status(500).json({ error: "Failed to create testimonial" });
  }
});

router.put("/testimonials/:id", auth, adminOnly, async (req, res) => {
  try {
    const testimonial = await Testimonial.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(testimonial);
  } catch (error) {
    res.status(500).json({ error: "Failed to update testimonial" });
  }
});

router.delete("/testimonials/:id", auth, adminOnly, async (req, res) => {
  try {
    await Testimonial.findByIdAndDelete(req.params.id);
    res.json({ message: "Testimonial deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete testimonial" });
  }
});

// ─── LAWYERS ──────────────────────────────────────────────────────────────

router.get("/lawyers", async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const lawyers = await Lawyer.find(filter).sort({ createdAt: -1 });
    res.json(lawyers);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch lawyers" });
  }
});

router.post("/lawyers", auth, adminOnly, async (req, res) => {
  try {
    const lawyer = new Lawyer(req.body);
    await lawyer.save();
    res.status(201).json(lawyer);
  } catch (error) {
    res.status(500).json({ error: "Failed to create lawyer" });
  }
});

router.put("/lawyers/:id", auth, adminOnly, async (req, res) => {
  try {
    const lawyer = await Lawyer.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(lawyer);
  } catch (error) {
    res.status(500).json({ error: "Failed to update lawyer" });
  }
});

router.delete("/lawyers/:id", auth, adminOnly, async (req, res) => {
  try {
    await Lawyer.findByIdAndDelete(req.params.id);
    res.json({ message: "Lawyer deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete lawyer" });
  }
});

// ─── INSIGHTS ─────────────────────────────────────────────────────────────

const Insight = require("../models/Insight");

router.get("/insights", async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const insights = await Insight.find(filter).sort({ createdAt: -1 });
    res.json(insights);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch insights" });
  }
});

router.post("/insights", auth, adminOnly, async (req, res) => {
  try {
    const insight = new Insight(req.body);
    await insight.save();
    res.status(201).json(insight);
  } catch (error) {
    res.status(500).json({ error: "Failed to create insight" });
  }
});

router.put("/insights/:id", auth, adminOnly, async (req, res) => {
  try {
    const insight = await Insight.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(insight);
  } catch (error) {
    res.status(500).json({ error: "Failed to update insight" });
  }
});

router.delete("/insights/:id", auth, adminOnly, async (req, res) => {
  try {
    await Insight.findByIdAndDelete(req.params.id);
    res.json({ message: "Insight deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete insight" });
  }
});

module.exports = router;
