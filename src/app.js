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
const advertisementRoutes = require("./routes/advertisements");
const leadRoutes = require("./routes/leads");
const analyticsRoutes = require("./routes/analytics");
const searchRoutes = require("./routes/search");

const app = express();

// ─── Security & Parsing ────────────────────────────────────────
app.use(helmet());
function normalizeOrigin(value) {
  if (!value) return "";

  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  const withoutLabel = trimmed
    .replace(/^FRONTEND_URL=/i, "")
    .replace(/^(https?:\/\/)FRONTEND_URL=/i, "$1");

  return withoutLabel.replace(/\/+$/, "");
}

function getAllowedOrigins(frontendUrlValue) {
  const defaults = ["http://localhost:5173", "http://localhost:3000"];
  const configuredOrigins = frontendUrlValue
    ? frontendUrlValue.split(",").map(normalizeOrigin).filter(Boolean)
    : [];

  return [...new Set([...defaults, ...configuredOrigins])];
}

const allowedOrigins = getAllowedOrigins(process.env.FRONTEND_URL);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin.replace(/\/+$/, ""))) {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  })
);
// Stream large property media before the global JSON parser. The dedicated route
// validates MIME/signature/size and pipes bytes directly to Cloudinary.
app.use(
  "/api/property-media",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: "Too many media uploads. Please try again later." } }),
  require("./routes/propertyMedia")
);
app.use(
  "/api/channel-partner-media",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: "Too many document uploads. Please try again later." } }),
  require("./routes/channelPartnerMedia")
);
// Keep legacy JSON/base64 payloads small. Property images and documents up to
// 50 MB use the streamed /api/property-media route above and never enter JSON.
app.use(express.json({ limit: "10mb" }));
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
app.use("/api/property-auth", require("./routes/propertyAuth"));
app.use("/api/login-reports", require("./routes/loginReports"));
app.use("/api/properties", propertyRoutes);
app.use("/api/dealers", dealerRoutes);
app.use("/api/builders", builderRoutes);
app.use("/api/hero", heroRoutes);
app.use("/api/advertisements", advertisementRoutes);
app.use("/api/cms", require("./routes/cms"));
app.use("/api/leads", leadRoutes);
app.use("/api/channel-partners", require("./routes/channelPartners"));
app.use("/api/channel-partner-auth", require("./routes/channelPartnerAuth"));
app.use("/api/channel-partner-leads", require("./routes/channelPartnerLeads"));
app.use("/api/analytics", analyticsRoutes);
app.use("/api/client-activity", require("./routes/clientActivity"));
app.use("/api/favorites", require("./routes/favorites"));
app.use("/api/system-notifications", require("./routes/systemNotifications"));
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
