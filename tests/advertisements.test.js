const request = require("supertest");
const app = require("../src/app");
const { createAdminToken } = require("./helpers");

describe("Advertisements API", () => {
  it("lets an admin upload an advertisement and exposes active ads publicly", async () => {
    const { token } = await createAdminToken();
    const create = await request(app)
      .post("/api/advertisements")
      .set("Authorization", `Bearer ${token}`)
      .send({ image: "https://example.com/ad.jpg", alt: "Summer homes", placement: "left", link: "https://example.com", order: 1 });
    expect(create.status).toBe(201);
    expect(create.body.advertisement.placement).toBe("left");

    const list = await request(app).get("/api/advertisements");
    expect(list.status).toBe(200);
    expect(list.body.advertisements).toHaveLength(1);
    expect(list.body.advertisements[0].alt).toBe("Summer homes");
  });
});
