require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const authRoutes = require("./routes/auth");
const propertyRoutes = require("./routes/properties");
const dealerRoutes = require("./routes/dealers");
const builderRoutes = require("./routes/builders");
const heroRoutes = require("./routes/hero");
const leadRoutes = require("./routes/leads");
const analyticsRoutes = require("./routes/analytics");
const searchRoutes = require("./routes/search");

const app = express();

// ─── Security & Parsing ────────────────────────────────────────
app.use(helmet());
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map((u) => u.trim())
  : "http://localhost:3000";

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

// ─── Global API rate limit (100 req/min per IP) ────────────────
app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    message: { error: "Too many requests. Please slow down." },
  })
);

// ─── Routes ─────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/properties", propertyRoutes);
app.use("/api/dealers", dealerRoutes);
app.use("/api/builders", builderRoutes);
app.use("/api/hero", heroRoutes);
app.use("/api/cms", require("./routes/cms"));
app.use("/api/leads", leadRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/search", searchRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

module.exports = app;
