const crypto = require("crypto");
const axios = require("axios");
const Otp = require("../models/Otp");

/**
 * Generate a 6-digit numeric OTP
 */
function generateOTP() {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Send OTP via Fast2SMS or log to console in dev mode
 */
async function sendOTP(phone, code) {
  const apiKey = process.env.FAST2SMS_API_KEY;

  // ── Dev mode: no API key configured ──
  if (!apiKey) {
    console.log("┌─────────────────────────────────────────┐");
    console.log("│  📱 DEV MODE — OTP NOT SENT VIA SMS     │");
    console.log(`│  Phone: ${phone}                        │`);
    console.log(`│  OTP:   ${code}                           │`);
    console.log("│  (Set FAST2SMS_API_KEY in .env to send)  │");
    console.log("└─────────────────────────────────────────┘");
    return { success: true, mode: "dev" };
  }

  // ── Production mode: send via Fast2SMS ──
  try {
    const response = await axios.get("https://www.fast2sms.com/dev/bulkV2", {
      params: {
        authorization: apiKey,
        variables_values: code,
        route: "otp",
        numbers: phone,
      },
    });

    if (response.data && response.data.return) {
      console.log(`✅ OTP sent to ${phone} via Fast2SMS`);
      return { success: true, mode: "sms" };
    } else {
      console.error("❌ Fast2SMS error:", response.data);
      console.log(`⚠️ Falling back to mock OTP mode for ${phone}. OTP: ${code}`);
      return { success: true, mode: "fallback", otp: code };
    }
  } catch (error) {
    console.error("❌ Fast2SMS request failed:", error.message);
    console.log(`⚠️ Falling back to mock OTP mode for ${phone}. OTP: ${code}`);
    return { success: true, mode: "fallback", otp: code };
  }
}

/**
 * Create and send a new OTP for the given phone number.
 * Invalidates any existing OTPs for that phone.
 */
async function createAndSendOTP(phone) {
  // Delete any existing OTPs for this phone
  await Otp.deleteMany({ phone });

  const code = generateOTP();
  const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 5;

  // Save to database
  await Otp.create({
    phone,
    code,
    expiresAt: new Date(Date.now() + expiryMinutes * 60 * 1000),
  });

  // Send via SMS or log to console
  const result = await sendOTP(phone, code);
  return result;
}

/**
 * Verify OTP for a phone number.
 * Returns true if valid, false otherwise.
 */
async function verifyOTP(phone, code) {
  // Atomic increment — prevents concurrent requests from bypassing the 5-attempt cap (DBG008)
  const otpDoc = await Otp.findOneAndUpdate(
    { phone, verified: false, attempts: { $lt: 5 } },
    { $inc: { attempts: 1 } },
    { sort: { _id: -1 }, new: true }
  );

  if (!otpDoc) {
    // Either no OTP exists, or attempts already >= 5
    const exhausted = await Otp.findOne({ phone, verified: false, attempts: { $gte: 5 } });
    if (exhausted) {
      await Otp.deleteOne({ _id: exhausted._id });
      return { valid: false, reason: "Too many attempts. Please request a new OTP." };
    }
    return { valid: false, reason: "No OTP found. Please request a new one." };
  }

  // Check expiry
  if (otpDoc.expiresAt < new Date()) {
    await Otp.deleteOne({ _id: otpDoc._id });
    return { valid: false, reason: "OTP has expired. Please request a new one." };
  }

  // Check code
  if (otpDoc.code !== code) {
    return { valid: false, reason: "Invalid OTP. Please try again." };
  }

  // Success — mark as verified and clean up
  await Otp.updateOne({ _id: otpDoc._id }, { verified: true });
  await Otp.deleteMany({ phone }); // Clean up all OTPs for this phone

  return { valid: true };
}

module.exports = { generateOTP, sendOTP, createAndSendOTP, verifyOTP };
