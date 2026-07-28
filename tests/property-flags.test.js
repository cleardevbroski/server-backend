const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const { createAdminToken } = require("./helpers");

describe("Property publish/feature flags", () => {
  it("defaults published=true and featured=false", async () => {
    const p = await Property.create({ title: "P", price: "1" });
    expect(p.published).toBe(true);
    expect(p.featured).toBe(false);
  });

  it("persists published/featured through the admin update route", async () => {
    const { token } = await createAdminToken();
    const p = await Property.create({ title: "P", price: "1" });
    const res = await request(app)
      .put(`/api/properties/${p._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ published: false, featured: true });
    expect(res.status).toBe(200);
    expect(res.body.property.published).toBe(false);
    expect(res.body.property.featured).toBe(true);
  });

  it("persists and clears multiple homepage placements", async () => {
    const { token } = await createAdminToken();
    const p = await Property.create({ title: "Placed property", price: "1" });

    const placed = await request(app)
      .put(`/api/properties/${p._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ homepageSections: ["Handpicked", "Offers", "Handpicked"] });

    expect(placed.status).toBe(200);
    expect(placed.body.property.homepageSections).toEqual(["Handpicked", "Offers"]);

    const cleared = await request(app)
      .put(`/api/properties/${p._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ homepageSections: [] });

    expect(cleared.status).toBe(200);
    expect(cleared.body.property.homepageSections).toEqual([]);
  });
});
