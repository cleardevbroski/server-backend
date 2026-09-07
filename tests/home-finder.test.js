const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");

describe("Find My Home recommendations", () => {
  it("requires the six buyer answers and ranks matching configurations without contact details", async () => {
    expect((await request(app).post("/api/home-finder/recommendations").send({})).status).toBe(400);
    await Property.create({
      title: "Family Match",
      builder: "Builder One",
      propertyType: "Apartment",
      listingType: "For Sale",
      status: "approved",
      published: true,
      price: "₹ 80 Lacs",
      configurationDetails: [{ configuration: "3 BHK", price: "₹ 80 Lacs", builtUpArea: "1400 Sq. Ft.", carpetArea: "1100 Sq. Ft.", bedrooms: 3, bathrooms: 3, balconies: 2, facings: ["East"] }],
      possessionDetails: { status: "Under Construction", expectedCompletionDate: "2027-03" },
      locality: { city: "Bangalore", latitude: 12.97, longitude: 77.59 },
      locationVerification: { status: "admin_verified", coordinateSource: "manual", inputLatitude: 12.97, inputLongitude: 77.59, resolvedAddress: "Bangalore", analyzedAt: new Date(), verifiedAt: new Date() },
      reraRegistered: true,
      reraPhases: [{ name: "Phase 1", reraNumber: "PRM/KA/RERA/12345678", reraDocuments: [{ key: "certificate", label: "RERA certificate", fileName: "rera.pdf", fileUrl: "https://example.com/rera.pdf", mimeType: "application/pdf", fileSize: 1000 }] }],
    });
    const response = await request(app).post("/api/home-finder/recommendations").send({
      purpose: "family_upgrade",
      destination: { query: "MG Road", resolvedAddress: "MG Road", latitude: 12.975, longitude: 77.606 },
      maxMonthlyEmi: 80000,
      downPayment: 3000000,
      bhk: 3,
      deadline: "2027-12",
    });
    expect(response.status).toBe(200);
    expect(response.body.recommendations[0].property.title).toBe("Family Match");
    expect(response.body.recommendations[0].reasons).toContain("3 BHK configuration available");
    expect(response.body.recommendations[0].distanceKm).toBeGreaterThan(0);
    expect(response.body.calculation.estimatedLoan).toBeGreaterThan(0);
  });
});
