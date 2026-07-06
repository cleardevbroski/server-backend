process.env.JWT_SECRET = "test-jwt-secret";
process.env.JWT_EXPIRY = "1h";
process.env.ADMIN_USERNAME = "testadmin";
process.env.ADMIN_PASSWORD = "Test@Password123";
process.env.FRONTEND_URL = "http://localhost:3000";
// mongod can take >10s to boot on slower machines; default launch timeout is 10s
process.env.MONGOMS_LAUNCH_TIMEOUT = process.env.MONGOMS_LAUNCH_TIMEOUT || "120000";
