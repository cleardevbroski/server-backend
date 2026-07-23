const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const { createAdminToken, createUserToken } = require("./helpers");

describe("Property submittedBy", () => {
  it("persists submittedBy='user' through Property.create", async () => {
    const p = await Property.create({ title: "P", price: "1", submittedBy: "user" });
    expect(p.submittedBy).toBe("user");
  });

  it("persists submittedBy through the admin create route", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "P", price: "1", submittedBy: "admin" });
    expect(res.status).toBe(201);
    expect(res.body.property.submittedBy).toBe("admin");
  });

  it("persists submittedBy='user' through the public submission route", async () => {
    const { token } = await createUserToken();
    const res = await request(app)
      .post("/api/properties/public")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "P", price: "1", submittedBy: "user" });
    expect(res.status).toBe(201);
    expect(res.body.property.submittedBy).toBe("user");
  });

  it("rejects an invalid submittedBy via validation", async () => {
    await expect(
      Property.create({ title: "P", price: "1", submittedBy: "bot" })
    ).rejects.toThrow();
  });
});
