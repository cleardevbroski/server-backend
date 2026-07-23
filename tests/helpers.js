const jwt = require("jsonwebtoken");
const User = require("../src/models/User");

async function createAdminToken() {
  const admin = await User.create({
    phone: "9000000001",
    role: "admin",
    isVerified: true,
  });
  const token = jwt.sign(
    { userId: admin._id, phone: admin.phone, role: "admin" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { token, admin };
}

async function createUserToken() {
  const user = await User.create({ phone: "9000000002", role: "user", isVerified: true });
  const token = jwt.sign(
    { userId: user._id, phone: user.phone, role: "user" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
  return { token, user };
}

module.exports = { createAdminToken, createUserToken };
