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

  it("does not expose approved properties that were unpublished", async () => {
    const visible = await Property.create({ title: "Live home", propertyType: "Apartment", status: "approved", published: true });
    const hidden = await Property.create({ title: "Removed home", propertyType: "Apartment", status: "approved", published: false });

    const list = await request(app).get("/api/properties?limit=100");
    expect(list.status).toBe(200);
    expect(list.body.properties.map((property) => property.id)).toContain(String(visible._id));
    expect(list.body.properties.map((property) => property.id)).not.toContain(String(hidden._id));

    const detail = await request(app).get(`/api/properties/${hidden._id}`);
    expect(detail.status).toBe(404);
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
