const request = require("supertest");
const app = require("../src/app");
const Builder = require("../src/models/Builder");
const { createAdminToken } = require("./helpers");

describe("Builders API", () => {
  it("lists builders sorted by projectCount when sort=-projects", async () => {
    await Builder.create({ name: "Sobha", slug: "sobha", projectCount: 5 });
    await Builder.create({ name: "Prestige", slug: "prestige", projectCount: 20 });
    const res = await request(app).get("/api/builders?sort=-projects");
    expect(res.status).toBe(200);
    expect(res.body.builders[0].slug).toBe("prestige");
  });

  it("returns 404 for an unknown slug", async () => {
    const res = await request(app).get("/api/builders/no-such-builder");
    expect(res.status).toBe(404);
  });

  it("rejects create without an admin token", async () => {
    const res = await request(app).post("/api/builders").send({ name: "X", slug: "x" });
    expect(res.status).toBe(401);
  });

  it("creates a builder with an admin token", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/builders")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Sobha", slug: "sobha", city: "Bangalore" });
    expect(res.status).toBe(201);
    expect(res.body.builder.slug).toBe("sobha");
  });

  it("toggles verified status", async () => {
    const { token } = await createAdminToken();
    const builder = await Builder.create({ name: "Sobha", slug: "sobha" });
    const res = await request(app)
      .patch(`/api/builders/${builder._id}/verify`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.builder.verified).toBe(true);
  });
});
