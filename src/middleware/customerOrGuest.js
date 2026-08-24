module.exports = function customerOrGuest(req, res, next) {
  if (!req.user || !["user", "guest"].includes(req.user.role)) {
    return res.status(403).json({ error: "Customer details are required" });
  }
  next();
};
