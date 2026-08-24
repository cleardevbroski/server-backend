module.exports = function propertyOwnerOnly(req, res, next) {
  if (!req.user || !["user", "property_submitter"].includes(req.user.role)) {
    return res.status(403).json({ error: "Property owner access required" });
  }
  next();
};
