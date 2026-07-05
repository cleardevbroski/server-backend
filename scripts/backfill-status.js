// One-time: stamp status on pre-existing records. Run: node scripts/backfill-status.js
require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Testimonial = require("../src/models/Testimonial");
  const Lawyer = require("../src/models/Lawyer");
  const Insight = require("../src/models/Insight");
  const Dealer = require("../src/models/Dealer");
  const Builder = require("../src/models/Builder");
  const Property = require("../src/models/Property");
  const Lead = require("../src/models/Lead");

  // Curated content: everything already live -> approved
  for (const M of [Testimonial, Lawyer, Insight, Dealer, Builder]) {
    const r = await M.updateMany({ status: { $exists: false } }, { $set: { status: "approved" } });
    console.log(`${M.modelName}: ${r.modifiedCount} -> approved`);
  }

  // Properties: preserve the old published semantics
  const p1 = await Property.updateMany({ status: { $exists: false }, published: { $ne: false } }, { $set: { status: "approved" } });
  const p2 = await Property.updateMany({ status: { $exists: false }, published: false }, { $set: { status: "pending" } });
  console.log(`Property: ${p1.modifiedCount} approved, ${p2.modifiedCount} pending`);

  // Leads: map legacy triage -> new enum
  const map = { new: "pending", contacted: "approved", closed: "rejected" };
  for (const [oldV, newV] of Object.entries(map)) {
    const r = await Lead.updateMany({ status: oldV }, { $set: { status: newV } });
    console.log(`Lead ${oldV} -> ${newV}: ${r.modifiedCount}`);
  }

  await mongoose.disconnect();
  console.log("backfill complete");
}
main().catch((e) => { console.error(e); process.exit(1); });
