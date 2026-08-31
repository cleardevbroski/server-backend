// Reconcile the live MongoDB deployment's indexes to what the Mongoose
// schemas declare. syncIndexes() builds any missing indexes and drops
// indexes that exist in the DB but are no longer in the schema.
//
//   node scripts/sync-indexes.js      (or: npm run db:sync-indexes)
//
// Reads MONGODB_URI from .env. Safe to run repeatedly.

require("dotenv").config();
const mongoose = require("mongoose");

// Require every model so it registers on the connection before we sync.
const models = {
  Property: require("../src/models/Property"),
  PropertyImportBatch: require("../src/models/PropertyImportBatch"),
  GeocodeCache: require("../src/models/GeocodeCache"),
  Builder: require("../src/models/Builder"),
  Dealer: require("../src/models/Dealer"),
  User: require("../src/models/User"),
  GuestSession: require("../src/models/GuestSession"),
  TruecallerVerification: require("../src/models/TruecallerVerification"),
  PropertyPosterAccount: require("../src/models/PropertyPosterAccount"),
  PropertyEmailOtp: require("../src/models/PropertyEmailOtp"),
  PropertyPosterDocument: require("../src/models/PropertyPosterDocument"),
  Lead: require("../src/models/Lead"),
  Lawyer: require("../src/models/Lawyer"),
  AnalyticsEvent: require("../src/models/AnalyticsEvent"),
  HeroBanner: require("../src/models/HeroBanner"),
  Insight: require("../src/models/Insight"),
  Testimonial: require("../src/models/Testimonial"),
  ChannelPartner: require("../src/models/ChannelPartner"),
  ChannelPartnerClient: require("../src/models/ChannelPartnerClient"),
  ChannelPartnerCounter: require("../src/models/ChannelPartnerCounter"),
};

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error("❌ MONGODB_URI is not set (check backend/.env)");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`✅ Connected: ${mongoose.connection.host}/${mongoose.connection.name}\n`);

  for (const [name, Model] of Object.entries(models)) {
    // syncIndexes returns the names of any indexes it dropped.
    const dropped = await Model.syncIndexes();
    const indexes = await Model.collection.indexes();
    const specs = indexes.map((i) => `${i.name}${i.expireAfterSeconds != null ? " (TTL)" : ""}`);
    console.log(`${name}: ${specs.join(", ")}`);
    if (dropped && dropped.length) console.log(`  ↳ dropped stale: ${dropped.join(", ")}`);
  }

  await mongoose.disconnect();
  console.log("\n✅ Index sync complete.");
}

main().catch((err) => {
  console.error("❌ Index sync failed:", err.message);
  process.exit(1);
});
