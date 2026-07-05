const request = require("supertest");
const app = require("../src/app");
const Lead = require("../src/models/Lead");
const Property = require("../src/models/Property");
const { createAdminToken } = require("./helpers");

describe("Analytics API", () => {
  it("tracks an event", async () => {
    const res = await request(app)
      .post("/api/analytics/track")
      .send({ eventType: "property_view", meta: { propertyId: "abc123" } });
    expect(res.status).toBe(201);
  });

  it("rejects tracking without an eventType", async () => {
    const res = await request(app).post("/api/analytics/track").send({});
    expect(res.status).toBe(400);
  });

  it("rejects the dashboard without an admin token", async () => {
    const res = await request(app).get("/api/analytics/dashboard");
    expect(res.status).toBe(401);
  });

  it("returns real aggregate counts on the dashboard", async () => {
    const { token } = await createAdminToken();
    await Property.create({ title: "P1", price: "1" });
    await Lead.create({ type: "contact", name: "A", status: "new" });
    await Lead.create({ type: "contact", name: "B", status: "closed" });

    const res = await request(app)
      .get("/api/analytics/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.totalProperties).toBe(1);
    expect(res.body.totalLeads).toBe(2);
    expect(res.body.leadsByStatus).toEqual(
      expect.arrayContaining([
        { status: "new", count: 1 },
        { status: "closed", count: 1 },
      ])
    );
  });
});
