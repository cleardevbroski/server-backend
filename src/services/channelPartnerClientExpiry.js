const ChannelPartnerClient = require("../models/ChannelPartnerClient");

async function expireChannelPartnerClients(now = new Date()) {
  return ChannelPartnerClient.updateMany(
    { status: "registered", ownershipExpiresAt: { $lte: now } },
    { $set: { status: "expired" } },
  );
}

module.exports = { expireChannelPartnerClients };
