const jwt = require("jsonwebtoken");
const User = require("../models/User");
const GuestSession = require("../models/GuestSession");
const PropertyPosterAccount = require("../models/PropertyPosterAccount");

/**
 * JWT authentication middleware.
 * Extracts token from Authorization header, verifies it,
 * and attaches the user document to req.user.
 */
const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided. Please log in." });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.propertyPosterId) {
      const poster = await PropertyPosterAccount.findById(decoded.propertyPosterId).select("-__v");
      if (!poster || poster.disabledAt) {
        return res.status(401).json({ error: "Property account not found. Please verify your email again." });
      }
      req.user = poster;
      req.isPropertyPoster = true;
      return next();
    }

    if (decoded.guestSessionId) {
      const guest = await GuestSession.findOne({ _id: decoded.guestSessionId, expiresAt: { $gt: new Date() } }).select("-__v");
      if (!guest) return res.status(401).json({ error: "Guest session expired. Please enter your details again." });
      req.user = guest;
      req.isGuest = true;
      return next();
    }

    const user = await User.findById(decoded.userId).select("-__v");
    if (!user) {
      return res.status(401).json({ error: "User not found. Please log in again." });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid token. Please log in again." });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired. Please log in again." });
    }
    return res.status(500).json({ error: "Authentication failed." });
  }
};

module.exports = auth;
