const crypto = require("crypto");
const axios = require("axios");
const Otp = require("../models/Otp");

/**
 * Generate a 6-digit numeric OTP
 */
function generateOTP() {
  return crypto.randomInt(100000, 1000000).toString();
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function canUseConsoleOtp() {
  return !isProduction() && process.env.OTP_DEV_MODE === "true";
}

/**
 * Send an OTP through Fast2SMS. Local development can log the OTP to the
 * server console, but an OTP must never be returned to a browser.
 */
async function sendOTP(phone, code) {
  const apiKey = process.env.FAST2SMS_API_KEY;

  // Console OTPs require an explicit local-development opt-in. A deployed
  // application must always be configured with a real SMS provider.
  if (!apiKey) {
    if (!canUseConsoleOtp()) {
      console.error("OTP delivery is not configured: FAST2SMS_API_KEY is missing.");
      return { success: false, error: "OTP delivery is not configured. Please contact support.", statusCode: 503 };
    }
    console.log("┌─────────────────────────────────────────┐");
    console.log("│  📱 DEV MODE — OTP NOT SENT VIA SMS     │");
    console.log(`│  Phone: ${phone}                        │`);
    console.log(`│  OTP:   ${code}                           │`);
    console.log("│  (Set FAST2SMS_API_KEY in .env to send)  │");
    console.log("└─────────────────────────────────────────┘");
    return { success: true, mode: "dev" };
  }

  // Fast2SMS's current API accepts OTP payloads as JSON with the key in an
  // Authorization header. Keeping the key out of the query string also
  // prevents it from being recorded in request URLs by intermediary logs.
  try {
    const response = await axios.post(
      "https://www.fast2sms.com/dev/bulkV2",
      {
        variables_values: code,
        route: "otp",
        numbers: phone,
      },
      {
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    if (response.data && response.data.return) {
      console.log(`✅ OTP sent to ${phone} via Fast2SMS`);
      return { success: true, mode: "sms" };
    } else {
      console.error("❌ Fast2SMS error:", response.data);
      return { success: false, error: "Unable to send the OTP. Please try again shortly.", statusCode: 503 };
    }
  } catch (error) {
    // Fast2SMS returns a useful status_code/message for account, KYC, DLT,
    // balance, and authentication failures. Log it on the server only.
    console.error("❌ Fast2SMS request failed:", error.response?.data || error.message);
    return { success: false, error: "Unable to send the OTP. Please try again shortly.", statusCode: 503 };
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
  if (!result.success) {
    // Do not leave a valid code behind when it was never delivered.
    await Otp.deleteMany({ phone });
  }
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
