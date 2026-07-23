module.exports = function customerOnly(req, res, next) {
  if (!req.user || req.user.role !== "user") {
    return res.status(403).json({ error: "Customer access required" });
  }
  next();
};
