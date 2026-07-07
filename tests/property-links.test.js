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
