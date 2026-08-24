jest.mock("axios", () => ({ get: jest.fn() }));

const axios = require("axios");
const request = require("supertest");
const app = require("../src/app");
const TruecallerVerification = require("../src/models/TruecallerVerification");
const User = require("../src/models/User");

describe("Truecaller customer verification", () => {
  beforeEach(() => {
    process.env.TRUECALLER_PARTNER_KEY = "test-partner-key";
    process.env.TRUECALLER_PARTNER_NAME = "ClearTitle One";
    axios.get.mockReset();
  });

  afterEach(() => {
    delete process.env.TRUECALLER_PARTNER_KEY;
    delete process.env.TRUECALLER_PARTNER_NAME;
  });

  it("does not expose the old phone-number bypass", async () => {
    const response = await request(app).post("/api/auth/truecaller-login").send({ phone: "9876543210" });
    expect(response.status).toBe(404);
    expect(await User.countDocuments()).toBe(0);
  });

  it("creates a short-lived mobile-web request", async () => {
    const response = await request(app).post("/api/auth/truecaller/start").send({ purpose: "login" });
    expect(response.status).toBe(201);
    expect(response.body.requestId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(response.body.deepLink).toContain("truecallersdk://truesdk/web_verify?");
    expect(response.body.deepLink).toContain("partnerKey=test-partner-key");
    expect(await TruecallerVerification.countDocuments({ requestId: response.body.requestId, status: "pending" })).toBe(1);
  });

  it("issues a customer token only after fetching a verified Truecaller profile", async () => {
    const started = await request(app).post("/api/auth/truecaller/start").send({ purpose: "enquiry" });
    axios.get.mockResolvedValueOnce({
      data: {
        phoneNumbers: ["919876543210"],
        name: { first: "Asha", last: "Rao" },
        onlineIdentities: { email: "asha@example.com" },
      },
    });

    const callback = await request(app).post("/api/auth/truecaller/callback").send({
      requestId: started.body.requestId,
      accessToken: "truecaller-access-token",
      endpoint: "https://profile4-noneu.truecaller.com/v1/default",
    });
    expect(callback.status).toBe(202);
    expect(axios.get).toHaveBeenCalledWith(
      "https://profile4-noneu.truecaller.com/v1/default",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer truecaller-access-token" }) })
    );

    const completed = await request(app).get(`/api/auth/truecaller/status/${started.body.requestId}`);
    expect(completed.status).toBe(200);
    expect(completed.body).toMatchObject({
      status: "verified",
      isNewUser: true,
      profileComplete: true,
      user: { phone: "9876543210", name: "Asha Rao", email: "asha@example.com", role: "user", isVerified: true, verificationSource: "truecaller" },
    });
    expect(completed.body.token).toEqual(expect.any(String));

    const replay = await request(app).get(`/api/auth/truecaller/status/${started.body.requestId}`);
    expect(replay.status).toBe(409);
  });

  it("rejects profile endpoints outside Truecaller's HTTPS domain", async () => {
    const started = await request(app).post("/api/auth/truecaller/start").send({});
    const callback = await request(app).post("/api/auth/truecaller/callback").send({
      requestId: started.body.requestId,
      accessToken: "untrusted-token",
      endpoint: "https://example.com/profile",
    });
    expect(callback.status).toBe(202);
    expect(axios.get).not.toHaveBeenCalled();

    const status = await request(app).get(`/api/auth/truecaller/status/${started.body.requestId}`);
    expect(status.body).toEqual({ status: "failed" });
  });
});
