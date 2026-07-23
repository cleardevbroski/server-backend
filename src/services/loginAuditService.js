const LoginAudit = require("../models/LoginAudit");

async function recordLoginAudit(req, { user, phone = "", email = "", method, status }) {
  try {
    await LoginAudit.create({
      user: user?._id || null,
      phone: user?.phone || phone,
      email: user?.email || email,
      role: user?.role || "",
      method,
      status,
      ipAddress: String(req.ip || ""),
      userAgent: String(req.get("user-agent") || ""),
    });
  } catch (error) {
    // Auditing must never prevent a valid sign-in from completing.
    console.error("Login audit error:", error.message);
  }
}

module.exports = { recordLoginAudit };
