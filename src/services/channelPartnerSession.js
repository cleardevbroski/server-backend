const jwt = require("jsonwebtoken");
const ChannelPartner = require("../models/ChannelPartner");

const ACTIVE_STATUSES = new Set(["active", "approved"]);

function createPartnerToken(partner) {
  return jwt.sign(
    {
      purpose: "channel-partner-client-registration",
      partnerId: partner._id.toString(),
      sessionVersion: partner.sessionVersion || 0,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.CHANNEL_PARTNER_SESSION_EXPIRY || "4h" },
  );
}

async function partnerSession(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Channel Partner code is required." });
    const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    if (decoded.purpose !== "channel-partner-client-registration" || !decoded.partnerId) return res.status(401).json({ error: "Invalid Channel Partner session." });
    const partner = await ChannelPartner.findById(decoded.partnerId);
    if (!partner || !ACTIVE_STATUSES.has(partner.status)) return res.status(403).json({ error: "This Channel Partner code is not active." });
    if ((decoded.sessionVersion || 0) !== (partner.sessionVersion || 0)) return res.status(401).json({ error: "Channel Partner session expired. Enter the current code again." });
    req.channelPartner = partner;
    return next();
  } catch (error) {
    return res.status(401).json({ error: error.name === "TokenExpiredError" ? "Channel Partner session expired. Enter the code again." : "Invalid Channel Partner session." });
  }
}

module.exports = { ACTIVE_STATUSES, createPartnerToken, partnerSession };
