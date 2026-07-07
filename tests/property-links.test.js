const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const { createAdminToken } = require("./helpers");
const Builder = require("../src/models/Builder");
const Dealer = require("../src/models/Dealer");
const { linkProperty, unlinkProperty, relinkProperty } = require("../src/services/propertyLinkSync");

describe("Property builderId/dealerId fields", () => {
  it("persists builderId and dealerId through Property.create", async () => {
    const builderId = "507f1f77bcf86cd799439011";
    const dealerId = "507f1f77bcf86cd799439012";
    const p = await Property.create({ title: "P", price: "1", builderId, dealerId });
    expect(p.builderId.toString()).toBe(builderId);
    expect(p.dealerId.toString()).toBe(dealerId);
  });

  it("defaults builderId and dealerId to null when not provided", async () => {
    const p = await Property.create({ title: "P", price: "1" });
    expect(p.builderId).toBeNull();
    expect(p.dealerId).toBeNull();
  });
});

describe("propertyLinkSync", () => {
  it("linkProperty increments the builder's projectCount and adds the property to the dealer's propertyIds", async () => {
    const builder = await Builder.create({ name: "Prestige Group", slug: "prestige-group" });
    const dealer = await Dealer.create({ name: "Ravi", slug: "ravi" });
    const property = await Property.create({ title: "P", price: "1", builderId: builder._id, dealerId: dealer._id });

    await linkProperty(property);

    const updatedBuilder = await Builder.findById(builder._id);
    const updatedDealer = await Dealer.findById(dealer._id);
    expect(updatedBuilder.projectCount).toBe(1);
    expect(updatedDealer.propertyIds.map(String)).toContain(property._id.toString());
  });

  it("unlinkProperty decrements the builder's projectCount and removes the property from the dealer's propertyIds", async () => {
    const builder = await Builder.create({ name: "Sobha", slug: "sobha", projectCount: 1 });
    const dealer = await Dealer.create({ name: "Meera", slug: "meera" });
    const property = await Property.create({ title: "P", price: "1", builderId: builder._id, dealerId: dealer._id });
    await Dealer.findByIdAndUpdate(dealer._id, { $addToSet: { propertyIds: property._id } });

    await unlinkProperty(property);

    const updatedBuilder = await Builder.findById(builder._id);
    const updatedDealer = await Dealer.findById(dealer._id);
    expect(updatedBuilder.projectCount).toBe(0);
    expect(updatedDealer.propertyIds.map(String)).not.toContain(property._id.toString());
  });

  it("unlinkProperty never drops a builder's projectCount below zero", async () => {
    const builder = await Builder.create({ name: "Godrej", slug: "godrej", projectCount: 0 });
    const property = await Property.create({ title: "P", price: "1", builderId: builder._id });

    await unlinkProperty(property);

    const updatedBuilder = await Builder.findById(builder._id);
    expect(updatedBuilder.projectCount).toBe(0);
  });

  it("relinkProperty moves the dealer link from the old dealer to the new dealer", async () => {
    const dealerA = await Dealer.create({ name: "A", slug: "dealer-a" });
    const dealerB = await Dealer.create({ name: "B", slug: "dealer-b" });
    const property = await Property.create({ title: "P", price: "1", dealerId: dealerA._id });
    await Dealer.findByIdAndUpdate(dealerA._id, { $addToSet: { propertyIds: property._id } });

    await relinkProperty(property, null, dealerB._id.toString());

    const updatedA = await Dealer.findById(dealerA._id);
    const updatedB = await Dealer.findById(dealerB._id);
    expect(updatedA.propertyIds.map(String)).not.toContain(property._id.toString());
    expect(updatedB.propertyIds.map(String)).toContain(property._id.toString());
  });
});

describe("Property routes — builder/dealer linkage", () => {
  it("POST /api/properties links the new property to its builder and dealer", async () => {
    const { token } = await createAdminToken();
    const builder = await Builder.create({ name: "Brigade", slug: "brigade" });
    const dealer = await Dealer.create({ name: "Karvy", slug: "karvy" });

    const res = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "P", price: "1", builderId: builder._id.toString(), dealerId: dealer._id.toString() });

    expect(res.status).toBe(201);
    const updatedBuilder = await Builder.findById(builder._id);
    const updatedDealer = await Dealer.findById(dealer._id);
    expect(updatedBuilder.projectCount).toBe(1);
    expect(updatedDealer.propertyIds.map(String)).toContain(res.body.property.id);
  });

  it("PUT /api/properties/:id moves the dealer link when dealerId changes", async () => {
    const { token } = await createAdminToken();
    const dealerA = await Dealer.create({ name: "A", slug: "dealer-a2" });
    const dealerB = await Dealer.create({ name: "B", slug: "dealer-b2" });
    const property = await Property.create({ title: "P", price: "1", dealerId: dealerA._id });
    await Dealer.findByIdAndUpdate(dealerA._id, { $addToSet: { propertyIds: property._id } });

    const res = await request(app)
      .put(`/api/properties/${property._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dealerId: dealerB._id.toString() });

    expect(res.status).toBe(200);
    const updatedA = await Dealer.findById(dealerA._id);
    const updatedB = await Dealer.findById(dealerB._id);
    expect(updatedA.propertyIds.map(String)).not.toContain(property._id.toString());
    expect(updatedB.propertyIds.map(String)).toContain(property._id.toString());
  });

  it("PUT /api/properties/:id clears the builder link when builderId is explicitly set to null", async () => {
    const { token } = await createAdminToken();
    const builder = await Builder.create({ name: "Sattva", slug: "sattva", projectCount: 1 });
    const property = await Property.create({ title: "P", price: "1", builderId: builder._id });

    const res = await request(app)
      .put(`/api/properties/${property._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ builderId: null });

    expect(res.status).toBe(200);
    expect(res.body.property.builderId).toBeNull();
    const updatedBuilder = await Builder.findById(builder._id);
    expect(updatedBuilder.projectCount).toBe(0);
  });

  it("PUT /api/properties/:id leaves the builder link untouched when builderId is omitted from the request", async () => {
    const { token } = await createAdminToken();
    const builder = await Builder.create({ name: "Assetz", slug: "assetz", projectCount: 1 });
    const property = await Property.create({ title: "P", price: "1", builderId: builder._id });

    const res = await request(app)
      .put(`/api/properties/${property._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "P updated" });

    expect(res.status).toBe(200);
    expect(res.body.property.builderId).toBe(builder._id.toString());
    const updatedBuilder = await Builder.findById(builder._id);
    expect(updatedBuilder.projectCount).toBe(1);
  });

  it("DELETE /api/properties/:id unlinks the property from its builder and dealer", async () => {
    const { token } = await createAdminToken();
    const builder = await Builder.create({ name: "Purva", slug: "purva", projectCount: 1 });
    const dealer = await Dealer.create({ name: "C", slug: "dealer-c" });
    const property = await Property.create({ title: "P", price: "1", builderId: builder._id, dealerId: dealer._id });
    await Dealer.findByIdAndUpdate(dealer._id, { $addToSet: { propertyIds: property._id } });

    const res = await request(app)
      .delete(`/api/properties/${property._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const updatedBuilder = await Builder.findById(builder._id);
    const updatedDealer = await Dealer.findById(dealer._id);
    expect(updatedBuilder.projectCount).toBe(0);
    expect(updatedDealer.propertyIds.map(String)).not.toContain(property._id.toString());
  });
});

describe("Builder/Dealer delete — referential integrity", () => {
  it("DELETE /api/builders/:id unsets builderId on properties that referenced it", async () => {
    const { token } = await createAdminToken();
    const builder = await Builder.create({ name: "Mantri", slug: "mantri" });
    const property = await Property.create({ title: "P", price: "1", builderId: builder._id });

    const res = await request(app)
      .delete(`/api/builders/${builder._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const updatedProperty = await Property.findById(property._id);
    expect(updatedProperty.builderId).toBeFalsy();
  });

  it("DELETE /api/dealers/:id unsets dealerId on properties that referenced it", async () => {
    const { token } = await createAdminToken();
    const dealer = await Dealer.create({ name: "D", slug: "dealer-d" });
    const property = await Property.create({ title: "P", price: "1", dealerId: dealer._id });

    const res = await request(app)
      .delete(`/api/dealers/${dealer._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    const updatedProperty = await Property.findById(property._id);
    expect(updatedProperty.dealerId).toBeFalsy();
  });
});
