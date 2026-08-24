const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const PropertyEmailOtp = require("../models/PropertyEmailOtp");
const PropertyPosterAccount = require("../models/PropertyPosterAccount");
const { sendPropertyLoginOtpEmail } = require("../services/emailService");

const router = express.Router();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_DELAY_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

const requestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many email-code requests. Please try again later." },
});
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === "test" ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many verification attempts. Please try again later." },
});

const normalizeEmail = (value) => String(value || "").trim().toLowerCase().slice(0, 180);
const otpHash = (email, otp) => crypto
  .createHmac("sha256", process.env.JWT_SECRET || "cleartitle-test-only-secret")
  .update(`property-email-login:${email}:${otp}`)
  .digest("hex");

function publicPoster(account) {
  return {
    id: account._id,
    email: account.email,
    name: account.name || "",
    phone: account.phone || "",
    role: account.role,
    isVerified: true,
    verificationSource: "email",
  };
}

router.post("/request-otp", requestLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!EMAIL.test(email)) return res.status(400).json({ error: "Enter a valid email address." });

    const now = new Date();
    const existing = await PropertyEmailOtp.findOne({ email }).lean();
    if (existing?.resendAvailableAt && new Date(existing.resendAvailableAt) > now) {
      const retryAfterSeconds = Math.max(1, Math.ceil((new Date(existing.resendAvailableAt).getTime() - now.getTime()) / 1000));
      return res.status(429).json({ error: `Please wait ${retryAfterSeconds} seconds before requesting another code.`, retryAfterSeconds });
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    await PropertyEmailOtp.findOneAndUpdate(
      { email },
      {
        $set: {
          otpHash: otpHash(email, otp),
          attempts: 0,
          expiresAt: new Date(now.getTime() + OTP_TTL_MS),
          resendAvailableAt: new Date(now.getTime() + RESEND_DELAY_MS),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    try {
      const delivery = await sendPropertyLoginOtpEmail({ email, otp });
      if (!delivery.delivered && !delivery.development) throw new Error("Email delivery is not configured on the server.");
      return res.json({
        message: "A verification code has been sent to your email.",
        expiresInSeconds: OTP_TTL_MS / 1000,
        resendAfterSeconds: RESEND_DELAY_MS / 1000,
        ...(delivery.development && process.env.NODE_ENV !== "production" ? { devOtp: otp } : {}),
      });
    } catch (emailError) {
      await PropertyEmailOtp.deleteOne({ email });
      console.error("Property login email failed:", emailError.message);
      return res.status(502).json({ error: emailError.message || "Unable to send the verification code." });
    }
  } catch (error) {
    console.error("Property email login request failed:", error);
    return res.status(500).json({ error: "Unable to send the verification code." });
  }
});

router.post("/verify-otp", verifyLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const otp = String(req.body?.otp || "").replace(/\D/g, "").slice(0, 6);
    if (!EMAIL.test(email) || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ error: "Enter your email and the six-digit verification code." });
    }

    const record = await PropertyEmailOtp.findOne({ email }).select("+otpHash");
    if (!record || record.expiresAt <= new Date()) {
      if (record) await record.deleteOne();
      return res.status(400).json({ error: "The verification code has expired. Request a new code." });
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      return res.status(429).json({ error: "Too many incorrect attempts. Request a new code." });
    }

    const received = Buffer.from(otpHash(email, otp), "hex");
    const expected = Buffer.from(record.otpHash, "hex");
    const valid = received.length === expected.length && crypto.timingSafeEqual(received, expected);
    if (!valid) {
      record.attempts += 1;
      await record.save();
      const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - record.attempts);
      return res.status(400).json({
        error: attemptsRemaining
          ? `Incorrect code. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.`
          : "Too many incorrect attempts. Request a new code.",
        attemptsRemaining,
      });
    }

    const now = new Date();
    const account = await PropertyPosterAccount.findOneAndUpdate(
      { email },
      { $set: { emailVerifiedAt: now, lastLoginAt: now } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    if (account.disabledAt) return res.status(403).json({ error: "This property account is disabled. Please contact support." });

    await record.deleteOne();
    const token = jwt.sign(
      { propertyPosterId: account._id, email: account.email, role: "property_submitter" },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRY || "30d" },
    );
    return res.json({ message: "Email verified successfully.", token, user: publicPoster(account) });
  } catch (error) {
    console.error("Property email login verification failed:", error);
    return res.status(500).json({ error: "Unable to verify the email code." });
  }
});

module.exports = router;
module.exports.publicPoster = publicPoster;
