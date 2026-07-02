require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const connectDB = require("./config/db");

// Route imports
const authRoutes = require("./routes/auth");
const propertyRoutes = require("./routes/properties");

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Security & Parsing ────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ─── Routes ─────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/properties", propertyRoutes);

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

// ─── Start Server ───────────────────────────────────────────────
async function start() {
  await connectDB();

  app.listen(PORT, () => {
    console.log("");
    console.log("╔══════════════════════════════════════════════╗");
    console.log("║   🏠 ClearTitle Backend API                  ║");
    console.log(`║   🚀 Server running on port ${PORT}              ║`);
    console.log(`║   📡 API: http://localhost:${PORT}/api           ║`);
    console.log("║                                              ║");
    if (!process.env.FAST2SMS_API_KEY) {
      console.log("║   ⚠️  OTP Dev Mode: ON (console logging)     ║");
    } else {
      console.log("║   ✅ OTP Provider: Fast2SMS                  ║");
    }
    console.log("╚══════════════════════════════════════════════╝");
    console.log("");
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
