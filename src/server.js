const app = require("./app");
const connectDB = require("./config/db");
const { expireChannelPartnerClients } = require("./services/channelPartnerClientExpiry");

const PORT = process.env.PORT || 5000;

async function start() {
  await connectDB();
  await expireChannelPartnerClients().catch((error) => console.error("Initial Channel Partner client expiry failed:", error.message));
  const expiryTimer = setInterval(() => {
    expireChannelPartnerClients().catch((error) => console.error("Channel Partner client expiry failed:", error.message));
  }, 60 * 60 * 1000);
  expiryTimer.unref();

  app.listen(PORT, () => {
    console.log("");
    console.log("╔══════════════════════════════════════════════╗");
    console.log("║   🏠 ClearTitle Backend API                  ║");
    console.log(`║   🚀 Server running on port ${PORT}              ║`);
    console.log(`║   📡 API: http://localhost:${PORT}/api           ║`);
    console.log("║   Property access: email verification        ║");
    console.log("╚══════════════════════════════════════════════╝");
    console.log("");
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
