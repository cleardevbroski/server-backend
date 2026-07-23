const request = require("supertest");
const app = require("../src/app");
const Lead = require("../src/models/Lead");
const Property = require("../src/models/Property");
const AnalyticsEvent = require("../src/models/AnalyticsEvent");
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

  it("rejects unsupported event names and removes personal metadata", async () => {
    expect((await request(app).post("/api/analytics/track").send({ eventType: "made_up_event" })).status).toBe(400);
    const res = await request(app).post("/api/analytics/track").send({
      eventType: "search",
      sessionId: "session_12345678",
      path: "/property-in-bangalore?q=whitefield",
      meta: { query: "Whitefield", email: "private@example.com", phone: "9876543210" },
    });
    expect(res.status).toBe(201);
    const event = await AnalyticsEvent.findOne({ eventType: "search" }).lean();
    expect(event.meta).toEqual({ query: "Whitefield" });
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
    await AnalyticsEvent.create([
      { eventType: "property_view", sessionId: "session_visitor_1", meta: { propertyId: "p1", propertyTitle: "P1", location: "Whitefield" } },
      { eventType: "property_view", sessionId: "session_visitor_2", meta: { propertyId: "p1", propertyTitle: "P1", location: "Whitefield" } },
      { eventType: "brochure_download", sessionId: "session_visitor_1", meta: { propertyId: "p1", propertyTitle: "P1" } },
      { eventType: "search", sessionId: "session_visitor_1", meta: { query: "Whitefield" } },
    ]);

    const res = await request(app)
      .get("/api/analytics/dashboard")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.totalProperties).toBe(1);
    expect(res.body.totalLeads).toBe(2);
    expect(res.body.totalEvents).toBe(4);
    expect(res.body.uniqueVisitors).toBe(2);
    expect(res.body.propertyViews).toBe(2);
    expect(res.body.conversionRate).toBe(50);
    expect(res.body.trend).toHaveLength(30);
    expect(res.body.topProperties[0]).toMatchObject({ propertyId: "p1", title: "P1", views: 2, interactions: 3 });
    expect(res.body.topSearches[0]).toMatchObject({ query: "Whitefield", count: 1 });
    expect(res.body.leadsByStatus).toEqual(
      expect.arrayContaining([
        { status: "new", count: 1 },
        { status: "closed", count: 1 },
      ])
    );
  });

  it("supports dashboard date periods and rejects unknown ranges", async () => {
    const { token } = await createAdminToken();
    const week = await request(app).get("/api/analytics/dashboard?days=7").set("Authorization", `Bearer ${token}`);
    expect(week.status).toBe(200);
    expect(week.body.period.days).toBe(7);
    expect(week.body.trend).toHaveLength(7);
    const invalid = await request(app).get("/api/analytics/dashboard?days=365").set("Authorization", `Bearer ${token}`);
    expect(invalid.status).toBe(400);
  });
});
