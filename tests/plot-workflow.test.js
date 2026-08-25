const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const { createAdminToken } = require("./helpers");

function plot(overrides = {}) {
  return {
    title: "Prestige Marigold Layout",
    subtitle: "Sarjapur Road, Bangalore",
    price: "",
    propertyType: "Plot",
    configs: ["30x40", "40 × 60"],
    builder: "Prestige Group",
    transactionType: "New Property",
    listingType: "For Sale",
    locality: { city: "Bangalore", pinCode: "560066" },
    plotDetails: {
      plotSizeDetails: [
        { plotSize: "30x40", pricePerSqft: 6500, facings: ["East", "North"] },
        { plotSize: "40 × 60", pricePerSqft: 6800, facings: ["East", "North"] },
      ],
      totalPlots: 2,
      approvalAuthority: "BMRDA",
      approvalNumber: "BMRDA/2026/1234",
      roadWidth: "30 ft internal roads",
      civicInfrastructure: { undergroundDrainage: "Ready", electricity: "Ready", water: "Under Development" },
      layoutMapUrl: "https://example.com/prestige-marigold-layout.png",
      layoutMapType: "image",
      layoutPossession: { status: "Under Development", expectedCompletionDate: "2027-12-01" },
      inventory: [
        { plotNumber: "A-101", plotSize: "30 × 40", facing: "East", status: "Available", isCorner: true },
        { plotNumber: "A-102", plotSize: "40x60", facing: "North", status: "Booked", isCorner: false },
      ],
    },
    ...overrides,
  };
}

describe("Plot property workflow", () => {
  it("normalizes sizes, derives pricing, and marks available corner plots", async () => {
    const { token } = await createAdminToken();
    const res = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send(plot());
    expect(res.status).toBe(201);
    expect(res.body.property.configs).toEqual(["30 × 40", "40 × 60"]);
    expect(res.body.property.plotDetails.plotSizeDetails[0]).toMatchObject({ areaSqft: 1200, totalPrice: 7800000 });
    expect(res.body.property.price).toBe("₹78 L - ₹1.63 Cr");
    expect(res.body.property.area).toBe("1200 - 2400 sqft");
    expect(res.body.property.possession).toBe("Under Development");
    expect(res.body.property.badges).toContain("Corner Plot");
  });

  it("allows approval when Plot facing is not yet available", async () => {
    const { token } = await createAdminToken();
    const payload = plot();
    payload.plotDetails.plotSizeDetails.forEach((row) => { row.facings = []; });
    payload.plotDetails.inventory.forEach((item) => { delete item.facing; });
    const res = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send(payload);
    expect(res.status).toBe(201);
    expect(res.body.property.plotDetails.plotSizeDetails.every((row) => row.facings.length === 0)).toBe(true);
    expect(res.body.property.plotDetails.inventory.every((item) => !item.facing)).toBe(true);
    expect(res.body.property.facing).toBe("");
  });

  it("requires matching size tags, exact inventory count, and a layout map", async () => {
    const { token } = await createAdminToken();
    const mismatch = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send(plot({ configs: ["30 × 40"] }));
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toMatch(/tags and detail rows/i);

    const count = plot();
    count.plotDetails.inventory.pop();
    const invalidCount = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send(count);
    expect(invalidCount.status).toBe(400);
    expect(invalidCount.body.error).toMatch(/inventory/i);

    const noMap = plot();
    noMap.plotDetails.layoutMapUrl = "";
    const invalidMap = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send(noMap);
    expect(invalidMap.status).toBe(400);
    expect(invalidMap.body.error).toMatch(/layout-map/i);
  });

  it("validates layout possession dates and structured data on update", async () => {
    const { token } = await createAdminToken();
    const created = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send(plot());
    expect(created.status).toBe(201);
    const invalidDetails = created.body.property.plotDetails;
    invalidDetails.layoutPossession = { status: "Layout Ready", expectedCompletionDate: "2027-12-01" };
    const res = await request(app).put(`/api/properties/${created.body.property.id}`).set("Authorization", `Bearer ${token}`).send({ plotDetails: invalidDetails });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ready date/i);
  });

  it("keeps plot listings publicly readable and searchable by size", async () => {
    const { token } = await createAdminToken();
    const created = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send(plot());
    expect(created.status).toBe(201);
    const res = await request(app).get("/api/properties?search=40%20x%2060");
    expect(res.status).toBe(200);
    expect(res.body.properties.map((item) => item.title)).toContain("Prestige Marigold Layout");
  });
});
