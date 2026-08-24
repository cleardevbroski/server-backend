const request = require("supertest");
const app = require("../src/app");
const GuestSession = require("../src/models/GuestSession");
const Lead = require("../src/models/Lead");
const User = require("../src/models/User");

describe("manual customer guest sessions", () => {
  const details = { name: "Asha Rao", email: "asha@example.com", phone: "9876543210", consent: true };

  it("stores manual details without claiming that the phone is verified", async () => {
    const response = await request(app).post("/api/auth/manual-session").send(details);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      user: {
        name: "Asha Rao",
        email: "asha@example.com",
        phone: "9876543210",
        role: "guest",
        isVerified: false,
        verificationSource: "manual",
      },
    });
    expect(response.body.token).toEqual(expect.any(String));
    expect(await GuestSession.countDocuments({ phone: "9876543210" })).toBe(1);
    expect(await User.countDocuments({ phone: "9876543210" })).toBe(0);

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${response.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ role: "guest", isVerified: false, verificationSource: "manual" });
  });

  it("accepts guest lead actions but blocks private customer resources", async () => {
    const session = await request(app).post("/api/auth/manual-session").send(details);
    const authorization = `Bearer ${session.body.token}`;

    const lead = await request(app)
      .post("/api/leads/property-interest")
      .set("Authorization", authorization)
      .send({
        propertyId: "property-123",
        propertyTitle: "Lakeview Heights",
        audience: "buyer",
        budget: "₹80 L - ₹1.2 Cr",
        action: "enquiry",
        phone: details.phone,
      });
    expect(lead.status).toBe(201);
    expect(await Lead.findOne({ phone: details.phone })).toMatchObject({ verificationSource: "manual", phoneVerified: false });

    const favorites = await request(app).get("/api/favorites").set("Authorization", authorization);
    expect(favorites.status).toBe(403);
  });

  it("removes the old customer SMS OTP endpoints", async () => {
    expect((await request(app).post("/api/auth/send-otp").send({ phone: details.phone })).status).toBe(404);
    expect((await request(app).post("/api/auth/verify-otp").send({ phone: details.phone, otp: "123456" })).status).toBe(404);
  });
});
