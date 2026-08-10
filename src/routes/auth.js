const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const rateLimit = require("express-rate-limit");
const User = require("../models/User");
const { createAndSendOTP, verifyOTP } = require("../services/otpService");
const auth = require("../middleware/auth");
const { hashPassword, verifyPassword } = require("../utils/password");
const { sendPasswordResetEmail } = require("../services/emailService");
const { recordLoginAudit } = require("../services/loginAuditService");

const router = express.Router();

// Rate limit OTP requests: max 5 per 15 minutes per IP
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many OTP requests. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

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

function signUserToken(user) {
  return jwt.sign(
    { userId: user._id, phone: user.phone, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || "30d" }
  );
}

function publicUser(user) {
  return { id: user._id, phone: user.phone, name: user.name, email: user.email, role: user.role };
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

// ─── POST /api/auth/send-otp ────────────────────────────────────
// Send an OTP to the given phone number
router.post(
  "/send-otp",
  otpLimiter,
  [
    body("phone")
      .trim()
      .matches(/^[6-9]\d{9}$/)
      .withMessage("Please enter a valid 10-digit Indian mobile number"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { phone } = req.body;
      const result = await createAndSendOTP(phone);

      if (result.success) {
        await recordLoginAudit(req, { phone, method: "otp_requested", status: "success" });
        return res.json({
          message: "OTP sent successfully",
          mode: result.mode, // "dev" or "sms"
          ...(result.mode === "dev" && result.devOtp ? { devOtp: result.devOtp } : {}),
        });
      } else {
        return res.status(result.statusCode || 500).json({ error: result.error || "Failed to send OTP" });
      }
    } catch (error) {
      console.error("Send OTP error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── POST /api/auth/verify-otp ──────────────────────────────────
// Verify OTP and return JWT token
router.post(
  "/verify-otp",
  [
    body("phone")
      .trim()
      .matches(/^[6-9]\d{9}$/)
      .withMessage("Invalid phone number"),
    body("otp")
      .trim()
      .isLength({ min: 6, max: 6 })
      .withMessage("OTP must be 6 digits"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { phone, otp } = req.body;
      const result = await verifyOTP(phone, otp);

      if (!result.valid) {
        return res.status(400).json({ error: result.reason });
      }

      // OTP verified — find or create user
      let user = await User.findOne({ phone });

      if (!user) {
        user = await User.create({
          phone,
          isVerified: true,
        });
        console.log(`🆕 New user registered: ${phone}`);
      } else {
        user.isVerified = true;
        await user.save();
      }

      // Generate JWT
      const token = jwt.sign(
        { userId: user._id, phone: user.phone, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRY || "30d" }
      );
      await recordLoginAudit(req, { user, method: "otp", status: "success" });

      return res.json({
        message: "Login successful",
        token,
        user: {
          id: user._id,
          phone: user.phone,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error) {
      console.error("Verify OTP error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── GET /api/auth/me ───────────────────────────────────────────
// Get current user profile (protected)
router.get("/me", auth, async (req, res) => {
  try {
    return res.json({
      user: {
        id: req.user._id,
        phone: req.user.phone,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
      },
    });
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
      if (email !== undefined) updates.email = email;

      const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true });

      return res.json({
        message: "Profile updated",
        user: {
          id: user._id,
          phone: user.phone,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ error: "That email address is already linked to another account" });
      console.error("Update profile error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── POST /api/auth/truecaller-login ─────────────────────────────
// Bypass OTP login for Truecaller mock
router.post(
  "/truecaller-login",
  [
    body("phone")
      .trim()
      .matches(/^[6-9]\d{9}$/)
      .withMessage("Invalid phone number"),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
      }

      const { phone } = req.body;

      // Reserved super-admin phone — never allow the unverified bypass to claim it
      if (phone === "9999999999") {
        return res.status(403).json({ error: "This phone number cannot be used for Truecaller login" });
      }

      // Find or create user
      let user = await User.findOne({ phone });

      // Never mint privileged tokens from an unverified client-supplied phone
      if (user && user.role === "admin") {
        return res.status(403).json({ error: "Truecaller login is not available for admin accounts" });
      }

      if (!user) {
        user = await User.create({ phone, isVerified: true });
        console.log(`🆕 New user registered via Truecaller bypass: ${phone}`);
      } else {
        user.isVerified = true;
        await user.save();
      }

      // Generate JWT
      const token = jwt.sign(
        { userId: user._id, phone: user.phone, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRY || "30d" }
      );

      return res.json({
        message: "Login successful (Truecaller Bypass)",
        token,
        user: {
          id: user._id,
          phone: user.phone,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      });
    } catch (error) {
      console.error("Truecaller login error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

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
