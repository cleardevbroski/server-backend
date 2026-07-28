const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const { createAdminToken } = require("./helpers");
const Builder = require("../src/models/Builder");
const Dealer = require("../src/models/Dealer");
const { linkProperty, unlinkProperty } = require("../src/services/propertyLinkSync");

describe("Property builder linkage without linked dealers", () => {
  it("persists builderId and ignores removed dealerId input", async () => {
    const builderId = "507f1f77bcf86cd799439011";
    const p = await Property.create({ title: "P", price: "1", builderId, dealerId: "507f1f77bcf86cd799439012" });
    expect(p.builderId.toString()).toBe(builderId);
    expect(p.dealerId).toBeUndefined();
  });

  it("linkProperty and unlinkProperty update only the builder count", async () => {
    const builder = await Builder.create({ name: "Prestige Group", slug: "prestige-group" });
    const dealer = await Dealer.create({ name: "Ravi", slug: "ravi" });
    const property = await Property.create({ title: "P", price: "1", builderId: builder._id, dealerId: dealer._id });

    await linkProperty(property);
    expect((await Builder.findById(builder._id)).projectCount).toBe(1);
    expect((await Dealer.findById(dealer._id)).propertyIds).toHaveLength(0);

    await unlinkProperty(property);
    expect((await Builder.findById(builder._id)).projectCount).toBe(0);
    expect((await Dealer.findById(dealer._id)).propertyIds).toHaveLength(0);
  });

  it("never drops a builder project count below zero", async () => {
    const builder = await Builder.create({ name: "Godrej", slug: "godrej", projectCount: 0 });
    const property = await Property.create({ title: "P", price: "1", builderId: builder._id });
    await unlinkProperty(property);
    expect((await Builder.findById(builder._id)).projectCount).toBe(0);
  });
});

describe("Property routes — builder-only linkage", () => {
  it("POST links the builder and strips dealerId", async () => {
    const { token } = await createAdminToken();
    const builder = await Builder.create({ name: "Brigade", slug: "brigade" });
    const dealer = await Dealer.create({ name: "Karvy", slug: "karvy" });
    const res = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "P", price: "1", builderId: builder._id.toString(), dealerId: dealer._id.toString() });

    expect(res.status).toBe(201);
    expect(res.body.property.dealerId).toBeUndefined();
    expect((await Builder.findById(builder._id)).projectCount).toBe(1);
    expect((await Dealer.findById(dealer._id)).propertyIds).toHaveLength(0);
  });

  it("PUT clears an explicitly null builder link and ignores dealerId", async () => {
    const { token } = await createAdminToken();
    const builder = await Builder.create({ name: "Sattva", slug: "sattva", projectCount: 1 });
    const dealer = await Dealer.create({ name: "A", slug: "dealer-a" });
    const property = await Property.create({ title: "P", price: "1", builderId: builder._id });
    const res = await request(app)
      .put(`/api/properties/${property._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ builderId: null, dealerId: dealer._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.property.builderId).toBeNull();
    expect(res.body.property.dealerId).toBeUndefined();
    expect((await Builder.findById(builder._id)).projectCount).toBe(0);
    expect((await Dealer.findById(dealer._id)).propertyIds).toHaveLength(0);
  });

  it("DELETE unlinks the builder", async () => {
    const { token } = await createAdminToken();
    const builder = await Builder.create({ name: "Purva", slug: "purva", projectCount: 1 });
    const property = await Property.create({ title: "P", price: "1", builderId: builder._id });
    const res = await request(app).delete(`/api/properties/${property._id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect((await Builder.findById(builder._id)).projectCount).toBe(0);
  });
});

describe("Builder/Dealer directory deletion", () => {
  it("unsets a deleted builder reference", async () => {
    const { token } = await createAdminToken();
    const builder = await Builder.create({ name: "Mantri", slug: "mantri" });
    const property = await Property.create({ title: "P", price: "1", builderId: builder._id });
    const res = await request(app).delete(`/api/builders/${builder._id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect((await Property.findById(property._id)).builderId).toBeFalsy();
  });

  it("deletes an independent dealer account", async () => {
    const { token } = await createAdminToken();
    const dealer = await Dealer.create({ name: "D", slug: "dealer-d" });
    const res = await request(app).delete(`/api/dealers/${dealer._id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(await Dealer.findById(dealer._id)).toBeNull();
  });
});
