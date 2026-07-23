const request = require("supertest");
const app = require("../src/app");

describe("POST /api/auth/admin-login", () => {
  it("accepts the credentials configured for the backend service", async () => {
    const res = await request(app)
      .post("/api/auth/admin-login")
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });

  it("does not trim a password configured with spaces", async () => {
    const originalPassword = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = " password with spaces ";
    const res = await request(app)
      .post("/api/auth/admin-login")
      .send({ username: process.env.ADMIN_USERNAME, password: " password with spaces " });
    process.env.ADMIN_PASSWORD = originalPassword;

    expect(res.status).toBe(200);
  });

  it("reports missing backend credentials as configuration, not an invalid password", async () => {
    const originalUsername = process.env.ADMIN_USERNAME;
    const originalPassword = process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
    const res = await request(app).post("/api/auth/admin-login").send({ username: "admin", password: "secret" });
    process.env.ADMIN_USERNAME = originalUsername;
    process.env.ADMIN_PASSWORD = originalPassword;

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });
});
