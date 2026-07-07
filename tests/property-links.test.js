const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const { createAdminToken } = require("./helpers");

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
