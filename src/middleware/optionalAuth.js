const jwt = require("jsonwebtoken");
const User = require("../models/User");

async function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return next();
  try {
    const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    req.user = await User.findById(decoded.userId).select("-__v");
  } catch {
    req.user = null;
  }
  return next();
}

module.exports = optionalAuth;
