const request = require("supertest");
const app = require("../src/app");
const Dealer = require("../src/models/Dealer");
const { createAdminToken } = require("./helpers");

describe("Dealers API", () => {
  it("lists dealers with pagination", async () => {
    await Dealer.create({ name: "Ravi Kumar", slug: "ravi-kumar" });
    const res = await request(app).get("/api/dealers");
    expect(res.status).toBe(200);
    expect(res.body.dealers).toHaveLength(1);
    expect(res.body.pagination).toEqual({ page: 1, limit: 20, total: 1, pages: 1 });
  });

  it("returns 404 for an unknown slug", async () => {
    const res = await request(app).get("/api/dealers/no-such-dealer");
    expect(res.status).toBe(404);
  });

  it("rejects create without an admin token", async () => {
    const res = await request(app).post("/api/dealers").send({ name: "X", slug: "x" });
    expect(res.status).toBe(401);
  });

  it("creates a dealer with an admin token", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/dealers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Ravi Kumar", slug: "ravi-kumar", city: "Bangalore" });
    expect(res.status).toBe(201);
    expect(res.body.dealer.slug).toBe("ravi-kumar");
  });

  it("rejects a duplicate slug", async () => {
    const { token } = await createAdminToken();
    await Dealer.create({ name: "Existing", slug: "dupe" });
    const res = await request(app)
      .post("/api/dealers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "New", slug: "dupe" });
    expect(res.status).toBe(400);
  });

  it("toggles verified status", async () => {
    const { token } = await createAdminToken();
    const dealer = await Dealer.create({ name: "Ravi", slug: "ravi", verified: false });
    const res = await request(app)
      .patch(`/api/dealers/${dealer._id}/verify`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.dealer.verified).toBe(true);
  });
});
