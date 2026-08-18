const ChannelPartnerClient = require("../models/ChannelPartnerClient");

async function expireChannelPartnerClients(now = new Date()) {
  return ChannelPartnerClient.updateMany(
    { status: "pending", claimActive: true, ownershipExpiresAt: { $lte: now } },
    {
      $set: { status: "expired", claimActive: false },
      $push: { statusHistory: { fromStatus: "pending", toStatus: "expired", reason: "Automatic 90-day expiry", actorLabel: "system", createdAt: now } },
    },
  );
}

module.exports = { expireChannelPartnerClients };
