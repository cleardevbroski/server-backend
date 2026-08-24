const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const rateLimit = require("express-rate-limit");
const User = require("../models/User");
const GuestSession = require("../models/GuestSession");
const PropertyPosterAccount = require("../models/PropertyPosterAccount");
const TruecallerVerification = require("../models/TruecallerVerification");
const { fetchTruecallerProfile } = require("../services/truecallerService");
const auth = require("../middleware/auth");
const { hashPassword, verifyPassword } = require("../utils/password");
const { sendPasswordResetEmail } = require("../services/emailService");
const { recordLoginAudit } = require("../services/loginAuditService");

const router = express.Router();

// Rate limit admin login: max 5 per 15 minutes per IP (CR004)
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many login attempts. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const customerAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many attempts. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const truecallerStartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many verification attempts. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const truecallerStatusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: "Too many verification status checks. Please try again shortly." },
  standardHeaders: true,
  legacyHeaders: false,
});

const TRUECALLER_REQUEST_TTL_MS = 2 * 60 * 1000;
const GUEST_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function signUserToken(user) {
  return jwt.sign(
    { userId: user._id, phone: user.phone, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || "30d" }
  );
}

function signGuestToken(guest) {
  return jwt.sign(
    { guestSessionId: guest._id, phone: guest.phone, role: "guest" },
    process.env.JWT_SECRET,
    { expiresIn: "30d" },
  );
}

function publicUser(user) {
  return {
    id: user._id,
    phone: user.phone,
    name: user.name,
    email: user.email,
    role: user.role,
    isVerified: Boolean(user.isVerified),
    verificationSource: user.verificationSource || (user.isVerified ? "unknown" : "manual"),
  };
}

function isProfileComplete(user) {
  return String(user?.name || "").trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(user?.email || ""));
}

async function findOrCreateTruecallerUser({ phone, name, email }) {
  let user = await User.findOne({ phone });
  if (user?.role === "admin") throw new Error("Administrator accounts cannot use customer verification");

  const safeEmail = email && !(await User.exists({ email, phone: { $ne: phone } })) ? email : undefined;
  if (!user) {
    user = await User.create({ phone, name, ...(safeEmail ? { email: safeEmail } : {}), isVerified: true, verificationSource: "truecaller" });
    return { user, isNewUser: true };
  }

  user.isVerified = true;
  user.verificationSource = "truecaller";
  if (!user.name && name) user.name = name;
  if (!user.email && safeEmail) user.email = safeEmail;
  await user.save();
  return { user, isNewUser: false };
}

router.post(
  "/register",
  customerAuthLimiter,
  [
    body("name").trim().isLength({ min: 2, max: 100 }).withMessage("Name is required"),
    body("phone").trim().matches(/^[6-9]\d{9}$/).withMessage("Please enter a valid 10-digit Indian mobile number"),
    body("email").trim().isEmail().normalizeEmail().withMessage("Please enter a valid email address"),
    body("password").isLength({ min: 8, max: 128 }).withMessage("Password must contain at least 8 characters"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
      const email = req.body.email.toLowerCase();
      if (await User.exists({ $or: [{ email }, { phone: req.body.phone }] })) {
        return res.status(409).json({ error: "An account already exists with this email or phone number" });
      }
      const user = await User.create({
        name: req.body.name,
        phone: req.body.phone,
        email,
        passwordHash: await hashPassword(req.body.password),
        isVerified: true,
        verificationSource: "password",
      });
      await recordLoginAudit(req, { user, method: "password_registration", status: "success" });
      return res.status(201).json({ message: "Account created", token: signUserToken(user), user: publicUser(user) });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ error: "An account already exists with this email or phone number" });
      console.error("Customer registration error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post(
  "/login",
  customerAuthLimiter,
  [body("email").trim().isEmail().normalizeEmail(), body("password").notEmpty()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: "Enter a valid email and password" });
      const user = await User.findOne({ email: req.body.email.toLowerCase() }).select("+passwordHash");
      if (!user || user.role !== "user" || !(await verifyPassword(req.body.password, user.passwordHash))) {
        await recordLoginAudit(req, { email: req.body.email, method: "password", status: "failed" });
        return res.status(401).json({ error: "Invalid email or password" });
      }
      await recordLoginAudit(req, { user, method: "password", status: "success" });
      return res.json({ message: "Login successful", token: signUserToken(user), user: publicUser(user) });
    } catch (error) {
      console.error("Customer login error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.post(
  "/forgot-password",
  customerAuthLimiter,
  [body("email").trim().isEmail().normalizeEmail()],
  async (req, res) => {
    const generic = { message: "If an account exists, password reset instructions have been sent." };
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.json(generic);
      const user = await User.findOne({ email: req.body.email.toLowerCase(), role: "user" }).select("+resetPasswordTokenHash +resetPasswordExpiresAt");
      if (!user) return res.json(generic);
      const token = crypto.randomBytes(32).toString("hex");
      user.resetPasswordTokenHash = crypto.createHash("sha256").update(token).digest("hex");
      user.resetPasswordExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await user.save();
      const delivery = await sendPasswordResetEmail({ email: user.email, name: user.name, token });
      return res.json({ ...generic, ...(process.env.NODE_ENV !== "production" ? { devResetUrl: delivery.devResetUrl } : {}) });
    } catch (error) {
      console.error("Forgot password error:", error);
      return res.json(generic);
    }
  }
);

router.post(
  "/reset-password",
  customerAuthLimiter,
  [
    body("email").trim().isEmail().normalizeEmail(),
    body("token").isLength({ min: 32 }),
    body("password").isLength({ min: 8, max: 128 }).withMessage("Password must contain at least 8 characters"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
      const tokenHash = crypto.createHash("sha256").update(req.body.token).digest("hex");
      const user = await User.findOne({
        email: req.body.email.toLowerCase(),
        resetPasswordTokenHash: tokenHash,
        resetPasswordExpiresAt: { $gt: new Date() },
      }).select("+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt");
      if (!user) return res.status(400).json({ error: "The reset link is invalid or has expired" });
      user.passwordHash = await hashPassword(req.body.password);
      user.resetPasswordTokenHash = "";
      user.resetPasswordExpiresAt = null;
      await user.save();
      return res.json({ message: "Password reset successful" });
    } catch (error) {
      console.error("Reset password error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// Manual visitors receive a guest session for lead forms and downloads. This
// never joins an existing verified account and cannot access private customer
// resources such as saved properties or property submissions.
router.post(
  "/manual-session",
  customerAuthLimiter,
  [
    body("name").trim().isLength({ min: 2, max: 100 }).withMessage("Enter your full name"),
    body("email").trim().isEmail().normalizeEmail().withMessage("Enter a valid email address"),
    body("phone").trim().matches(/^[6-9]\d{9}$/).withMessage("Enter a valid 10-digit Indian mobile number"),
    body("consent").custom((value) => value === true).withMessage("Consent is required"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
      const now = new Date();
      const guest = await GuestSession.create({
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,
        consentAt: now,
        expiresAt: new Date(now.getTime() + GUEST_SESSION_TTL_MS),
      });
      await recordLoginAudit(req, { phone: guest.phone, email: guest.email, method: "manual", status: "success" });
      return res.status(201).json({
        message: "Details saved",
        token: signGuestToken(guest),
        user: publicUser(guest),
      });
    } catch (error) {
      console.error("Create manual guest session error:", error);
      return res.status(500).json({ error: "Unable to save your details" });
    }
  },
);

// ─── GET /api/auth/me ───────────────────────────────────────────
// Get current user profile (protected)
router.get("/me", auth, async (req, res) => {
  try {
    return res.json({ user: publicUser(req.user) });
  } catch (error) {
    console.error("Get profile error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PUT /api/auth/profile ──────────────────────────────────────
// Update user profile (protected)
router.put(
  "/profile",
  auth,
  [
    body("name").optional().trim().isLength({ max: 100 }),
    body("email").optional().trim().isEmail().withMessage("Invalid email"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { name, email } = req.body;
      const updates = {};
      if (name !== undefined) updates.name = name;
      if (email !== undefined) {
        if (req.isPropertyPoster && String(email).trim().toLowerCase() !== req.user.email) {
          return res.status(400).json({ error: "Verify a new email address before changing the property account email" });
        }
        updates.email = email;
      }

      const user = req.isPropertyPoster
        ? await PropertyPosterAccount.findByIdAndUpdate(req.user._id, updates, { new: true })
        : req.user.role === "guest"
          ? await GuestSession.findByIdAndUpdate(req.user._id, updates, { new: true })
          : await User.findByIdAndUpdate(req.user._id, updates, { new: true });

      return res.json({
        message: "Profile updated",
        user: publicUser(user),
      });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ error: "That email address is already linked to another account" });
      console.error("Update profile error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── Truecaller mobile-web verification ─────────────────────────
// The browser never supplies a phone number as proof of identity. Truecaller
// posts a short-lived access token to this backend, which fetches the verified
// profile before a customer JWT can be issued.
router.post(
  "/truecaller/start",
  truecallerStartLimiter,
  [body("purpose").optional().isIn(["login", "enquiry", "brochure", "site_visit", "contact"])],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: "Invalid verification purpose" });
      const partnerKey = String(process.env.TRUECALLER_PARTNER_KEY || "").trim();
      if (!partnerKey) return res.status(503).json({ error: "Truecaller verification is not configured yet. Enter your details manually." });

      const requestId = crypto.randomBytes(24).toString("base64url");
      const params = new URLSearchParams({
        type: "btmsheet",
        requestNonce: requestId,
        partnerKey,
        partnerName: process.env.TRUECALLER_PARTNER_NAME || "ClearTitle One",
        lang: "en",
        loginPrefix: "continue",
        loginSuffix: "loginsignup",
        ctaPrefix: "continuewith",
        ctaColor: "#121B35",
        ctaTextColor: "#F2C052",
        btnShape: "round",
        skipOption: "useanothermethod",
        ttl: "90000",
      });
      if (process.env.TRUECALLER_PRIVACY_URL) params.set("privacyUrl", process.env.TRUECALLER_PRIVACY_URL);
      if (process.env.TRUECALLER_TERMS_URL) params.set("termsUrl", process.env.TRUECALLER_TERMS_URL);

      await TruecallerVerification.create({
        requestId,
        purpose: req.body.purpose || "login",
        expiresAt: new Date(Date.now() + TRUECALLER_REQUEST_TTL_MS),
      });
      return res.status(201).json({
        requestId,
        deepLink: `truecallersdk://truesdk/web_verify?${params.toString()}`,
        expiresInSeconds: TRUECALLER_REQUEST_TTL_MS / 1000,
      });
    } catch (error) {
      console.error("Start Truecaller verification error:", error);
      return res.status(500).json({ error: "Unable to start Truecaller verification" });
    }
  }
);

router.post("/truecaller/callback", async (req, res) => {
  const requestId = String(req.body?.requestId || "");
  try {
    if (!requestId) return res.status(202).json({ accepted: true });
    const verification = await TruecallerVerification.findOne({ requestId });
    if (!verification || verification.expiresAt <= new Date() || ["consumed", "rejected"].includes(verification.status)) {
      return res.status(202).json({ accepted: true });
    }

    if (req.body.status === "flow_invoked") {
      verification.status = "invoked";
      await verification.save();
      return res.status(202).json({ accepted: true });
    }
    if (req.body.status === "user_rejected") {
      verification.status = "rejected";
      await verification.save();
      return res.status(202).json({ accepted: true });
    }

    const profile = await fetchTruecallerProfile(req.body.endpoint, req.body.accessToken);
    verification.status = "verified";
    verification.phone = profile.phone;
    verification.name = profile.name;
    verification.email = profile.email;
    verification.failureReason = "";
    await verification.save();
    return res.status(202).json({ accepted: true });
  } catch (error) {
    if (requestId) {
      await TruecallerVerification.updateOne(
        { requestId, status: { $in: ["pending", "invoked"] } },
        { $set: { status: "failed", failureReason: String(error.message || "Profile verification failed").slice(0, 300) } }
      ).catch(() => {});
    }
    console.error("Truecaller callback error:", error.response?.data || error.message);
    return res.status(202).json({ accepted: true });
  }
});

router.get("/truecaller/status/:requestId", truecallerStatusLimiter, async (req, res) => {
  try {
    const requestId = String(req.params.requestId || "");
    const verification = await TruecallerVerification.findOne({ requestId });
    if (!verification) return res.status(404).json({ error: "Verification request not found" });
    if (verification.expiresAt <= new Date()) return res.status(410).json({ error: "Truecaller verification expired. Enter your details manually." });
    if (verification.status === "rejected") return res.json({ status: "rejected" });
    if (verification.status === "failed") return res.json({ status: "failed" });
    if (verification.status === "consumed") return res.status(409).json({ error: "Verification request has already been used" });
    if (verification.status !== "verified") return res.json({ status: verification.status });

    const { user, isNewUser } = await findOrCreateTruecallerUser(verification);
    const consumed = await TruecallerVerification.findOneAndUpdate(
      { _id: verification._id, status: "verified" },
      { $set: { status: "consumed" } },
      { new: true }
    );
    if (!consumed) return res.status(409).json({ error: "Verification request has already been used" });

    await recordLoginAudit(req, { user, method: "truecaller", status: "success" });
    return res.json({
      status: "verified",
      token: signUserToken(user),
      user: publicUser(user),
      isNewUser,
      profileComplete: isProfileComplete(user),
    });
  } catch (error) {
    if (error.message === "Administrator accounts cannot use customer verification") {
      return res.status(403).json({ error: error.message });
    }
    console.error("Complete Truecaller verification error:", error);
    return res.status(500).json({ error: "Unable to complete Truecaller verification" });
  }
});

// ─── POST /api/auth/admin-login ───────────────────────────────
// Dedicated admin login for the dashboard
router.post(
  "/admin-login",
  adminLoginLimiter,
  [
    body("username").trim().notEmpty(),
    body("password").notEmpty(),
  ],
  async (req, res) => {
    try {
      const username = req.body.username?.trim();
      // A password may intentionally contain spaces. Do not trim it before the
      // comparison or it can never match the value stored in Render.
      const password = req.body.password;

      // Constant-time comparison to prevent timing attacks (CR004)
      const expectedUser = process.env.ADMIN_USERNAME || "";
      const expectedPass = process.env.ADMIN_PASSWORD || "";
      if (!expectedUser || !expectedPass) {
        console.error("Admin login is unavailable: ADMIN_USERNAME or ADMIN_PASSWORD is not configured on the backend service.");
        return res.status(503).json({ error: "Admin login is not configured on the backend service." });
      }
      const userBuf = Buffer.from(username || "");
      const passBuf = Buffer.from(password || "");
      const expectedUserBuf = Buffer.from(expectedUser);
      const expectedPassBuf = Buffer.from(expectedPass);

      const userMatch = userBuf.length === expectedUserBuf.length &&
        crypto.timingSafeEqual(userBuf, expectedUserBuf);
      const passMatch = passBuf.length === expectedPassBuf.length &&
        crypto.timingSafeEqual(passBuf, expectedPassBuf);

      if (!userMatch || !passMatch) {
        await recordLoginAudit(req, { phone: "9999999999", method: "password", status: "failed" });
        return res.status(401).json({ error: "Invalid admin credentials" });
      }

      // Ensure an admin user exists in DB to associate with the token
      let adminUser = await User.findOne({ role: "admin", phone: "9999999999" });
      if (!adminUser) {
        adminUser = await User.create({
          phone: "9999999999",
          name: "Super Admin",
          isVerified: true,
          role: "admin",
        });
      }

      const token = jwt.sign(
        { userId: adminUser._id, phone: adminUser.phone, role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRY || "30d" }
      );
      await recordLoginAudit(req, { user: adminUser, method: "password", status: "success" });

      return res.json({
        message: "Admin login successful",
        token,
        user: {
          id: adminUser._id,
          role: "admin",
        },
      });
    } catch (error) {
      console.error("Admin login error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
