const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const { createAdminToken } = require("./helpers");

describe("Property listingType", () => {
  it("defaults listingType to 'For Sale'", async () => {
    const p = await Property.create({ title: "P", price: "1" });
    expect(p.listingType).toBe("For Sale");
  });

  it("persists listingType='For Rent' through the admin update route", async () => {
    const { token } = await createAdminToken();
    const p = await Property.create({ title: "P", price: "1" });
    const res = await request(app)
      .put(`/api/properties/${p._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ listingType: "For Rent" });
    expect(res.status).toBe(200);
    expect(res.body.property.listingType).toBe("For Rent");
  });

  it("rejects an invalid listingType via validation", async () => {
    await expect(
      Property.create({ title: "P", price: "1", listingType: "Lease" })
    ).rejects.toThrow();
  });
});
