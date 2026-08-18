require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const ChannelPartnerClient = require("../src/models/ChannelPartnerClient");

async function migrate() {
  await connectDB();
  const now = new Date();
  const mappings = [
    ["registered", "pending"],
    ["converted", "successful"],
    ["cancelled", "rejected"],
    ["expired", "expired"],
  ];

  for (const [fromStatus, toStatus] of mappings) {
    await ChannelPartnerClient.collection.updateMany(
      { status: fromStatus },
      {
        $set: { status: toStatus, claimActive: false },
        $push: { statusHistory: { fromStatus, toStatus, reason: "Lifecycle migration", actorLabel: "migration", createdAt: now } },
      },
    );
  }

  await ChannelPartnerClient.collection.updateMany({ claimActive: { $exists: false } }, { $set: { claimActive: false } });
  const activeClaims = await ChannelPartnerClient.collection.aggregate([
    { $match: { status: { $in: ["pending", "approved", "successful"] } } },
    { $sort: { registeredAt: -1, _id: -1 } },
    { $group: { _id: "$mobileHash", clientId: { $first: "$_id" } } },
  ]).toArray();
  if (activeClaims.length) {
    await ChannelPartnerClient.collection.updateMany(
      { _id: { $in: activeClaims.map((item) => item.clientId) } },
      { $set: { claimActive: true } },
    );
  }

  const indexes = await ChannelPartnerClient.collection.indexes();
  for (const index of indexes) {
    if (index.key?.mobileHash === 1 && index.unique && index.partialFilterExpression?.status) {
      await ChannelPartnerClient.collection.dropIndex(index.name);
    }
  }
  await ChannelPartnerClient.syncIndexes();
  console.log("Channel Partner client lifecycle migration complete.");
}

migrate()
  .catch((error) => {
    console.error("Channel Partner lifecycle migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
