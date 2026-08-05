const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
const SystemNotification = require("../models/SystemNotification");

const router = express.Router();
const reportLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 1000 : 20, message: { error: "Too many error reports." } });
const clean = (value, max) => String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);

router.post("/report", reportLimiter, async (req, res) => {
  try {
    const message = clean(req.body?.message, 500) || "Unknown application error";
    const path = clean(req.body?.path, 500) || "/";
    const componentStack = clean(req.body?.componentStack, 2000);
    const fingerprint = crypto.createHash("sha256").update(`${path}:${message}`).digest("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    await SystemNotification.updateOne(
      { fingerprint },
      {
        $setOnInsert: { fingerprint, type: "application_error", title: "Website error detected", firstOccurredAt: now },
        $set: { message, path, componentStack, lastOccurredAt: now, unread: true, expiresAt },
        $inc: { occurrences: 1 },
      },
      { upsert: true },
    );
    return res.status(202).json({ message: "Error report received" });
  } catch (error) {
    console.error("System error report failed:", error);
    return res.status(202).json({ message: "Error report acknowledged" });
  }
});

router.get("/admin", auth, adminOnly, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const [notifications, unreadCount] = await Promise.all([
      SystemNotification.find().sort({ lastOccurredAt: -1 }).limit(limit).lean(),
      SystemNotification.countDocuments({ unread: true }),
    ]);
    return res.json({
      notifications: notifications.map((item) => ({
        id: item._id.toString(), type: item.type, title: item.title, message: item.message,
        path: item.path, occurrences: item.occurrences, unread: item.unread,
        firstOccurredAt: item.firstOccurredAt, lastOccurredAt: item.lastOccurredAt,
      })),
      unreadCount,
    });
  } catch (error) {
    console.error("System notifications list failed:", error);
    return res.status(500).json({ error: "Unable to load notifications." });
  }
});

router.patch("/admin/read-all", auth, adminOnly, async (_req, res) => {
  try {
    await SystemNotification.updateMany({ unread: true }, { $set: { unread: false } });
    return res.json({ message: "Notifications marked as read" });
  } catch (error) {
    console.error("Mark all notifications read failed:", error);
    return res.status(500).json({ error: "Unable to update notifications." });
  }
});

router.patch("/admin/:id/read", auth, adminOnly, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Notification not found." });
    const notification = await SystemNotification.findByIdAndUpdate(req.params.id, { $set: { unread: false } }, { new: true });
    if (!notification) return res.status(404).json({ error: "Notification not found." });
    return res.json({ message: "Notification marked as read" });
  } catch (error) {
    console.error("Mark notification read failed:", error);
    return res.status(500).json({ error: "Unable to update notification." });
  }
});

module.exports = router;
