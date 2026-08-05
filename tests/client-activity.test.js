const request = require("supertest");
const app = require("../src/app");
const PropertyEngagement = require("../src/models/PropertyEngagement");
const VisitorProfile = require("../src/models/VisitorProfile");
const VisitorSession = require("../src/models/VisitorSession");
const { createAdminToken, createUserToken } = require("./helpers");

const identity = { visitorId: "visitor_abcdefghijklmnop", visitId: "visit_abcdefghijklmnop" };

describe("Client activity API", () => {
  it("counts a visit once and starts a new visit after the browser creates a new session", async () => {
    const first = await request(app).post("/api/client-activity/visit").send({ ...identity, path: "/property/p1", deviceCategory: "mobile" });
    const replay = await request(app).post("/api/client-activity/visit").send({ ...identity, path: "/property/p1" });
    const second = await request(app).post("/api/client-activity/visit").send({ ...identity, visitId: "visit_second_abcdefgh", path: "/property/p2" });

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(second.status).toBe(201);
    expect((await VisitorProfile.findOne()).visitCount).toBe(2);
    expect(await VisitorSession.countDocuments()).toBe(2);
  });

  it("upserts compact property engagement summaries and links an authenticated customer", async () => {
    const customer = await createUserToken({ phone: "9876543299", name: "Meera" });
    const payload = {
      ...identity,
      propertyId: "property-one",
      propertyTitle: "ClearTitle Heights",
      propertyType: "Apartment",
      location: "Whitefield",
      priceLabel: "₹1.2 Cr onwards",
      activeSeconds: 75,
    };
    const first = await request(app).post("/api/client-activity/engagement").set("Authorization", `Bearer ${customer.token}`).send(payload);
    const second = await request(app).post("/api/client-activity/engagement").set("Authorization", `Bearer ${customer.token}`).send({ ...payload, activeSeconds: 30, action: "priceList" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const visitor = await VisitorProfile.findOne();
    const engagement = await PropertyEngagement.findOne();
    expect(visitor.userId.toString()).toBe(customer.user._id.toString());
    expect(visitor.visitCount).toBe(1);
    expect(visitor.totalActiveSeconds).toBe(105);
    expect(engagement.viewCount).toBe(2);
    expect(engagement.activeSeconds).toBe(105);
    expect(engagement.actionCount).toBe(1);
    expect(engagement.budgetBand).toBe("₹1–1.5 Cr");
    expect(engagement.actions.priceList).toBe(1);
  });

  it("protects admin activity and supports visit-frequency filters and details", async () => {
    await request(app).post("/api/client-activity/engagement").send({
      ...identity,
      propertyId: "villa-one",
      propertyTitle: "Lake Villas",
      propertyType: "Villa",
      priceLabel: "2.2 Cr",
      activeSeconds: 125,
    });
    expect((await request(app).get("/api/client-activity/admin/visitors")).status).toBe(401);

    const { token } = await createAdminToken();
    const list = await request(app).get("/api/client-activity/admin/visitors?visits=1").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.visitors).toHaveLength(1);
    expect(list.body.visitors[0]).toMatchObject({ visitCount: 1, identified: false, interest: { propertyType: "Villa", budgetBand: "₹2–3 Cr" } });
    expect(list.body.counts).toMatchObject({ total: 1, one: 1, two: 0, three: 0, fourPlus: 0 });

    const detail = await request(app).get(`/api/client-activity/admin/visitors/${list.body.visitors[0].id}`).set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.sessions).toHaveLength(1);
    expect(detail.body.engagements[0]).toMatchObject({ propertyTitle: "Lake Villas", activeSeconds: 125 });
  });

  it("rejects malformed visitor identifiers and unsupported actions", async () => {
    expect((await request(app).post("/api/client-activity/visit").send({ visitorId: "short", visitId: "short" })).status).toBe(400);
    const invalidAction = await request(app).post("/api/client-activity/engagement").send({ ...identity, propertyId: "p1", action: "mouse_move" });
    expect(invalidAction.status).toBe(400);
  });
});
