const request = require("supertest");
const app = require("../src/app");
const { createAdminToken } = require("./helpers");

function commercial(overrides = {}) {
  return { title: "Brigade Tech Park Office", subtitle: "Whitefield, Bangalore", price: "₹2.4 Cr", pricePerSqft: "₹10,000/sqft", propertyType: "Commercial", builder: "Brigade Group", transactionType: "New Property", listingType: "For Sale", locality: { city: "Bangalore", pinCode: "560066" }, possessionDetails: { status: "Ready to Move", launchDate: "2025-01-15" }, commercialDetails: { commercialSubtype: "Office Space", carpetArea: "1800 sqft", builtUpArea: "2100 sqft", superArea: "2400 sqft", floor: "5", totalFloors: 12, frontage: "", zoneType: "IT/ITES SEZ", seatingCapacity: 50, cabins: 5, meetingRooms: 1, buildingGrade: "Grade A", structure: "RCC, earthquake resistant", pantry: "Shared Pantry", washrooms: "2 private", parking: "4 Covered + 2 Open", powerBackup: "100% backup", sanctionedLoadKva: 15, fireSafetyCompliance: "NOC available", furnishing: "Warm Shell" }, ...overrides };
}

describe("Commercial property workflow", () => {
  it("creates an office listing with commercial structured details", async () => {
    const { token } = await createAdminToken();
    const res = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send(commercial());
    expect(res.status).toBe(201);
    expect(res.body.property.commercialDetails.commercialSubtype).toBe("Office Space");
    expect(res.body.property.area).toBe("2400 sqft");
    expect(res.body.property.configs).toEqual(["Office Space"]);
    expect(res.body.property.facing || "").toBe("");
  });
  it("requires frontage for a shop/showroom", async () => {
    const { token } = await createAdminToken();
    const payload = commercial(); payload.commercialDetails.commercialSubtype = "Shop/Showroom";
    const res = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send(payload);
    expect(res.status).toBe(400); expect(res.body.error).toMatch(/frontage/i);
  });
});
