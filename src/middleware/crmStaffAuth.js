const jwt = require("jsonwebtoken");
const CRMStaffAccount = require("../models/CRMStaffAccount");

const crmStaffAuth = async (req, res, next) => {
  try {
    const header = String(req.headers.authorization || "");
    if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "Employee login is required." });
    const decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    if (decoded.tokenType !== "crm_staff" || !decoded.staffId) return res.status(401).json({ error: "Invalid employee session." });
    const staff = await CRMStaffAccount.findById(decoded.staffId);
    if (!staff || staff.isDeleted || !staff.isActive) return res.status(403).json({ error: "This employee account is inactive." });
    if ((decoded.sessionVersion || 0) !== (staff.sessionVersion || 0)) return res.status(401).json({ error: "Employee session expired. Sign in again." });
    req.crmStaff = staff;
    return next();
  } catch (error) {
    return res.status(401).json({ error: error.name === "TokenExpiredError" ? "Employee session expired. Sign in again." : "Invalid employee session." });
  }
};

function requireCrmPermission(permission) {
  return (req, res, next) => {
    if (!req.crmStaff?.permissions?.includes(permission)) return res.status(403).json({ error: "Your employee account does not have permission for this action." });
    return next();
  };
}

module.exports = { crmStaffAuth, requireCrmPermission };
