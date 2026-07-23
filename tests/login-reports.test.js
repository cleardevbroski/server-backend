const request = require("supertest");
const app = require("../src/app");
const LoginAudit = require("../src/models/LoginAudit");
const { createAdminToken } = require("./helpers");

describe("Login reports API", () => {
  it("lists safe authentication audit records for an admin", async () => {
    const { token } = await createAdminToken();
    await LoginAudit.create({ phone: "9876543210", method: "otp", status: "success" });
    const res = await request(app).get("/api/login-reports").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.reports[0]).toMatchObject({ phone: "9876543210", method: "otp", status: "success" });
    expect(res.body.reports[0]).not.toHaveProperty("otp");
    expect(res.body.reports[0]).not.toHaveProperty("password");
  });
});
