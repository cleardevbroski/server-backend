const request = require("supertest");
const app = require("../src/app");
const HeroBanner = require("../src/models/HeroBanner");
const { createAdminToken } = require("./helpers");

describe("Hero Banners API", () => {
  it("lists only published banners, sorted by order", async () => {
    await HeroBanner.create({ image: "a.jpg", title: "A", order: 2, published: true });
    await HeroBanner.create({ image: "b.jpg", title: "B", order: 1, published: true });
    await HeroBanner.create({ image: "c.jpg", title: "C", order: 0, published: false });
    const res = await request(app).get("/api/hero/banners");
    expect(res.status).toBe(200);
    expect(res.body.banners.map((b) => b.title)).toEqual(["B", "A"]);
  });

  it("rejects create without an admin token", async () => {
    const res = await request(app).post("/api/hero/banners").send({ image: "a.jpg", title: "X" });
    expect(res.status).toBe(401);
  });

  it("creates a banner with an admin token", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/hero/banners")
      .set("Authorization", `Bearer ${token}`)
      .send({ image: "a.jpg", title: "New Banner" });
    expect(res.status).toBe(201);
    expect(res.body.banner.title).toBe("New Banner");
  });

  it("updates banner order via PATCH /:id/order", async () => {
    const { token } = await createAdminToken();
    const banner = await HeroBanner.create({ image: "a.jpg", title: "A", order: 0 });
    const res = await request(app)
      .patch(`/api/hero/banners/${banner._id}/order`)
      .set("Authorization", `Bearer ${token}`)
      .send({ order: 5 });
    expect(res.status).toBe(200);
    expect(res.body.banner.order).toBe(5);
  });

  it("deletes a banner", async () => {
    const { token } = await createAdminToken();
    const banner = await HeroBanner.create({ image: "a.jpg", title: "A" });
    const res = await request(app)
      .delete(`/api/hero/banners/${banner._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
