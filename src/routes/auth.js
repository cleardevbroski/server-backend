const express = require("express");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const rateLimit = require("express-rate-limit");
const User = require("../models/User");
const { createAndSendOTP, verifyOTP } = require("../services/otpService");
const auth = require("../middleware/auth");

const router = express.Router();

// Rate limit OTP requests: max 5 per 15 minutes per IP
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many OTP requests. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

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
        return res.json({
          message: "OTP sent successfully",
          mode: result.mode, // "dev" or "sms" — frontend can show appropriate message
        });
      } else {
        return res.status(500).json({ error: result.error || "Failed to send OTP" });
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
      console.error("Update profile error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

module.exports = router;
