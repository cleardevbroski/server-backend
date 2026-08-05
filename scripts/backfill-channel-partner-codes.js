require("dotenv").config();
const mongoose = require("mongoose");
const ChannelPartner = require("../src/models/ChannelPartner");
const ChannelPartnerCounter = require("../src/models/ChannelPartnerCounter");
const { encryptSensitive, hashLookup } = require("../src/utils/channelPartnerCrypto");

async function nextCode() {
  const counter = await ChannelPartnerCounter.findOneAndUpdate(
    { _id: "channel-partner-code" },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return `CT-${String(counter.sequence).padStart(4, "0")}`;
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured");
  await mongoose.connect(process.env.MONGODB_URI);
  const partners = await ChannelPartner.find({ partnerCodeHash: { $exists: false } }).select("_id status");
  let updated = 0;
  for (const partner of partners) {
    const code = await nextCode();
    await ChannelPartner.updateOne(
      { _id: partner._id, partnerCodeHash: { $exists: false } },
      {
        $set: {
          partnerCodeHash: hashLookup(code, "partner-code"),
          partnerCodeEncrypted: encryptSensitive(code),
          partnerCodeLast4: code.slice(-4),
          activatedAt: new Date(),
          status: "active",
        },
        $push: { reviewHistory: { fromStatus: partner.status || "submitted", toStatus: "active", note: "Activated during Channel Partner code migration", createdAt: new Date() } },
      },
    );
    updated += 1;
  }
  console.log(`Backfilled ${updated} Channel Partner code(s). No emails were sent.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Channel Partner code backfill failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
