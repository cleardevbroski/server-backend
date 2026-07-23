const express = require("express");
const LoginAudit = require("../models/LoginAudit");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");

const router = express.Router();

router.get("/", auth, adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 50, method, status } = req.query;
    const filter = {};
    if (method) filter.method = String(method);
    if (status) filter.status = String(status);
    const limitNumber = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const pageNumber = Math.max(Number(page) || 1, 1);
    const [reports, total] = await Promise.all([
      LoginAudit.find(filter).sort({ createdAt: -1 }).skip((pageNumber - 1) * limitNumber).limit(limitNumber).lean(),
      LoginAudit.countDocuments(filter),
    ]);
    return res.json({ reports: reports.map((report) => ({ ...report, id: report._id.toString() })), pagination: { page: pageNumber, limit: limitNumber, total, pages: Math.ceil(total / limitNumber) } });
  } catch (error) {
    console.error("List login reports error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
