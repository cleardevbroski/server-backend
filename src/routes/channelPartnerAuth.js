const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const ChannelPartner = require("../models/ChannelPartner");
const ChannelPartnerCounter = require("../models/ChannelPartnerCounter");
const ChannelPartnerRecovery = require("../models/ChannelPartnerRecovery");
const { encryptSensitive, hashLookup } = require("../utils/channelPartnerCrypto");
const { ACTIVE_STATUSES } = require("../services/channelPartnerSession");
const { sendChannelPartnerRecoveryOtpEmail, sendChannelPartnerCodeRotatedEmail } = require("../services/emailService");

const router = express.Router();
const requestLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 1000 : 5, message: { error: "Too many recovery requests. Please try again later." } });
const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.NODE_ENV === "test" ? 1000 : 10, message: { error: "Too many OTP attempts. Please try again later." } });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_DELAY_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

const normalizeEmail = (value) => String(value || "").trim().toLowerCase().slice(0, 180);

async function nextPartnerCode() {
  const counter = await ChannelPartnerCounter.findOneAndUpdate(
    { _id: "channel-partner-code" },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return `CT-${String(counter.sequence).padStart(4, "0")}`;
}

async function activePartnerForEmail(email) {
  const matches = await ChannelPartner.find({ "contact.email": email }).limit(3);
  if (!matches.length) return { error: "not_registered" };
  const active = matches.filter((partner) => ACTIVE_STATUSES.has(partner.status));
  if (!active.length) return { error: "not_active" };
  if (active.length > 1) return { error: "ambiguous" };
  return { partner: active[0] };
}

async function requestRecovery(req, res) {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!EMAIL.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    const lookup = await activePartnerForEmail(email);
    if (lookup.error === "not_registered") return res.status(404).json({ error: "This email is not registered as a Channel Partner.", registrationUrl: "/channel-partner" });
    if (lookup.error === "not_active") return res.status(403).json({ error: "This Channel Partner account is not active. Please contact support." });
    if (lookup.error === "ambiguous") return res.status(409).json({ error: "More than one active Channel Partner uses this email. Please contact support." });

    const now = new Date();
    const existing = await ChannelPartnerRecovery.findOne({ email }).lean();
    if (existing?.resendAvailableAt && new Date(existing.resendAvailableAt) > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((new Date(existing.resendAvailableAt).getTime() - now.getTime()) / 1000));
      return res.status(429).json({ error: `Please wait ${retryAfterSeconds} seconds before requesting another OTP.`, retryAfterSeconds });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    await ChannelPartnerRecovery.findOneAndUpdate(
      { email },
      {
        $set: {
          partnerId: lookup.partner._id,
          otpHash: hashLookup(otp, `channel-partner-recovery:${lookup.partner._id}`),
          attempts: 0,
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
          resendAvailableAt: new Date(now.getTime() + RESEND_DELAY_MS),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    try {
      const result = await sendChannelPartnerRecoveryOtpEmail({ email, name: lookup.partner.company.name, otp });
      if (!result.delivered) throw new Error("Email delivery is not configured on the server.");
    } catch (emailError) {
      await ChannelPartnerRecovery.deleteOne({ email });
      console.error("Channel Partner recovery OTP email failed:", emailError.message);
      return res.status(502).json({ error: emailError.message || "Unable to send the recovery OTP." });
    }

    return res.json({ message: "OTP sent to your registered email address.", expiresInSeconds: OTP_TTL_MS / 1000, resendAfterSeconds: RESEND_DELAY_MS / 1000 });
  } catch (error) {
    console.error("Channel Partner code recovery request failed:", error);
    return res.status(500).json({ error: "Unable to start CP code recovery." });
  }
}

router.post("/forgot-code", requestLimiter, requestRecovery);
router.post("/resend-otp", requestLimiter, requestRecovery);

router.post("/verify-otp", verifyLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || "").replace(/\D/g, "").slice(0, 6);
    if (!EMAIL.test(email) || !/^\d{6}$/.test(otp)) return res.status(400).json({ error: "Enter the registered email and six-digit OTP." });

    const recovery = await ChannelPartnerRecovery.findOne({ email }).select("+otpHash");
    if (!recovery || recovery.expiresAt <= new Date()) {
      if (recovery) await recovery.deleteOne();
      return res.status(400).json({ error: "The OTP has expired. Request a new OTP." });
    }
    if (recovery.attempts >= MAX_ATTEMPTS) return res.status(429).json({ error: "Too many incorrect OTP attempts. Request a new OTP." });

    const receivedHash = hashLookup(otp, `channel-partner-recovery:${recovery.partnerId}`);
    const validOtp = crypto.timingSafeEqual(Buffer.from(recovery.otpHash, "hex"), Buffer.from(receivedHash, "hex"));
    if (!validOtp) {
      recovery.attempts += 1;
      await recovery.save();
      const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - recovery.attempts);
      return res.status(400).json({ error: attemptsRemaining ? `Incorrect OTP. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.` : "Too many incorrect OTP attempts. Request a new OTP.", attemptsRemaining });
    }

    const partner = await ChannelPartner.findById(recovery.partnerId).select("+partnerCodeHash +partnerCodeEncrypted");
    if (!partner || !ACTIVE_STATUSES.has(partner.status)) return res.status(403).json({ error: "This Channel Partner account is not active. Please contact support." });

    const newCode = await nextPartnerCode();
    const previous = {
      hash: partner.partnerCodeHash,
      encrypted: partner.partnerCodeEncrypted,
      last4: partner.partnerCodeLast4,
      sessionVersion: partner.sessionVersion || 0,
      codeRotatedAt: partner.codeRotatedAt || null,
    };
    partner.partnerCodeHash = hashLookup(newCode, "partner-code");
    partner.partnerCodeEncrypted = encryptSensitive(newCode);
    partner.partnerCodeLast4 = newCode.slice(-4);
    partner.sessionVersion = previous.sessionVersion + 1;
    partner.codeRotatedAt = new Date();
    await partner.save();

    try {
      const result = await sendChannelPartnerCodeRotatedEmail({ email, name: partner.company.name, applicationNumber: partner.applicationNumber, partnerCode: newCode });
      if (!result.delivered) throw new Error("Email delivery is not configured on the server.");
    } catch (emailError) {
      partner.partnerCodeHash = previous.hash;
      partner.partnerCodeEncrypted = previous.encrypted;
      partner.partnerCodeLast4 = previous.last4;
      partner.sessionVersion = previous.sessionVersion;
      partner.codeRotatedAt = previous.codeRotatedAt;
      await partner.save();
      console.error("Channel Partner replacement code email failed:", emailError.message);
      return res.status(502).json({ error: "The new code could not be delivered. Your existing code remains active." });
    }

    await recovery.deleteOne();
    return res.json({ message: "A new Channel Partner code has been sent to your email. Your previous code is no longer active.", dashboardUrl: "/cp-dashboard" });
  } catch (error) {
    if (error.code === "ENCRYPTION_NOT_CONFIGURED") return res.status(503).json({ error: "Channel Partner recovery is not configured." });
    console.error("Channel Partner recovery OTP verification failed:", error);
    return res.status(500).json({ error: "Unable to verify OTP and replace the CP code." });
  }
});

module.exports = router;
