const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const AffordabilityRule = require("../src/models/AffordabilityRule");
const { createAdminToken } = require("./helpers");

describe("affordability rules and calculations", () => {
  it("lets admins manage assumptions and dated government rules", async () => {
    const { token } = await createAdminToken();
    const settings = await request(app).put("/api/affordability/settings").set("Authorization", `Bearer ${token}`).send({
      defaultInterestRate: 8.25,
      defaultTenureYears: 25,
      comfortableIncomeRatioMin: 0.3,
      comfortableIncomeRatioMax: 0.4,
      defaultState: "Karnataka",
      disclaimer: "Estimate only",
    });
    expect(settings.status).toBe(200);
    expect(settings.body.settings.defaultTenureYears).toBe(25);

    const created = await request(app).post("/api/affordability/rules").set("Authorization", `Bearer ${token}`).send({
      name: "Stamp duty",
      code: "stamp_duty",
      state: "Karnataka",
      propertyTypes: ["Apartment"],
      calculationType: "percentage",
      basis: "base_price",
      rate: 5,
      effectiveFrom: "2020-01-01",
      sourceLabel: "Configured government rule",
    });
    expect(created.status).toBe(201);
    expect(await AffordabilityRule.countDocuments()).toBe(1);
  });

  it("returns an itemized acquisition-cost and EMI estimate", async () => {
    await AffordabilityRule.create({ name: "Registration", code: "registration", state: "Karnataka", calculationType: "percentage", basis: "base_price", rate: 1, effectiveFrom: new Date("2020-01-01") });
    const property = await Property.create({
      title: "Costed Home",
      propertyType: "Apartment",
      status: "approved",
      published: true,
      locality: { city: "Bangalore" },
      configurationDetails: [{ configuration: "3 BHK", price: "₹ 1 Cr", builtUpArea: "1500 Sq. Ft.", carpetArea: "1200 Sq. Ft.", bedrooms: 3, facings: [] }],
      acquisitionCharges: [{ name: "Parking", code: "parking", calculationType: "fixed", value: 500000, paymentTiming: "initial", sourceType: "developer_supplied" }],
    });
    const response = await request(app).post(`/api/affordability/properties/${property._id}/calculate`).send({ configurationName: "3 BHK", loanAmount: 8000000, interestRate: 8.5, tenureYears: 20 });
    expect(response.status).toBe(200);
    expect(response.body.affordability.basePrice).toBe(10000000);
    expect(response.body.affordability.projectCharges[0]).toMatchObject({ label: "Parking", amount: 500000 });
    expect(response.body.affordability.governmentCharges[0]).toMatchObject({ label: "Registration", amount: 100000 });
    expect(response.body.affordability.totalPurchaseCost).toBe(10600000);
    expect(response.body.affordability.monthlyEmi).toBeGreaterThan(0);
    expect(response.body.affordability.suggestedMonthlyIncome.min).toBeGreaterThan(response.body.affordability.monthlyEmi);
  });
});
