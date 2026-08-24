module.exports = function propertySubmitterOnly(req, res, next) {
  if (!req.user || req.user.role !== "property_submitter" || !req.isPropertyPoster) {
    return res.status(403).json({ error: "Verified property-poster access required" });
  }
  next();
};
