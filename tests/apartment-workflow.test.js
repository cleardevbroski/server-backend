const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const { createAdminToken } = require("./helpers");

function apartment(overrides = {}) {
  return {
    title: "Lakeview Heights",
    subtitle: "Whitefield, Bangalore",
    price: "₹1.70 Cr",
    propertyType: "Apartment",
    configs: ["2 BHK", "3 BHK"],
    configurationDetails: [
      {
        configuration: "2 BHK",
        price: "₹1.70 Cr",
        superBuiltUpArea: "1280 sqft",
        carpetArea: "915 sqft",
        bedrooms: 2,
        bathrooms: 2,
        balconies: 1,
        facings: ["East", "North-East"],
      },
      {
        configuration: "3 BHK",
        price: "₹2.30 Cr",
        superBuiltUpArea: "1730 sqft",
        carpetArea: "1245 sqft",
        bedrooms: 3,
        bathrooms: 3,
        balconies: 2,
        facings: ["South"],
      },
    ],
    possessionDetails: { status: "Under Construction", expectedCompletionDate: "2028-06-30" },
    transactionType: "New Property",
    bookingAmount: "₹5,00,000",
    description: "A well-connected apartment project with spacious homes and modern shared amenities.",
    locality: { city: "Bangalore", pinCode: "560066" },
    ...overrides,
  };
}

describe("Apartment property workflow", () => {
  it("normalizes and persists per-configuration details with derived summaries", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(apartment({ configs: ["2bhk", "3 BHK"] }));

    expect(res.status).toBe(201);
    expect(res.body.property.configs).toEqual(["2 BHK", "3 BHK"]);
    expect(res.body.property.configurationDetails).toHaveLength(2);
    expect(res.body.property.price).toBe("₹1.70 Cr - ₹2.30 Cr");
    expect(res.body.property.area).toBe("1280 sqft - 1730 sqft");
    expect(res.body.property.possession).toBe("Under Construction");
  });

  it("rejects mismatched tags and rows", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(apartment({ configs: ["2 BHK", "4 BHK"] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tags and detail rows/i);
  });

  it.each([
    ["Ready to Move", { launchDate: "2024-01-15" }],
    ["New Launch", { launchDate: "2027-01-15" }],
    ["Under Construction", { expectedCompletionDate: "2028-01-15" }],
  ])("accepts %s with its matching date", async (status, dates) => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(apartment({ possessionDetails: { status, ...dates } }));
    expect(res.status).toBe(201);
    expect(res.body.property.possessionDetails.status).toBe(status);
  });

  it("rejects stale possession dates and missing conditional fields", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(apartment({
        possessionDetails: {
          status: "Under Construction",
          launchDate: "2024-01-01",
          expectedCompletionDate: "2028-01-15",
        },
      }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expected completion date/i);
  });

  it("requires conditional RERA and booking fields", async () => {
    const { token } = await createAdminToken();
    const rera = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(apartment({ reraRegistered: true, reraNumber: "" }));
    expect(rera.status).toBe(400);
    expect(rera.body.error).toMatch(/RERA number/i);

    const booking = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(apartment({ bookingAmount: "" }));
    expect(booking.status).toBe(400);
    expect(booking.body.error).toMatch(/Booking amount/i);
  });

  it("matches a nested bedroom configuration in the public list", async () => {
    await Property.create(apartment({ status: "approved" }));
    const res = await request(app).get("/api/properties?bedrooms=3");
    expect(res.status).toBe(200);
    expect(res.body.properties).toHaveLength(1);
  });

  it("keeps legacy Apartments readable and moderation-updatable", async () => {
    const { token } = await createAdminToken();
    const legacy = await Property.create({
      title: "Legacy Apartment",
      price: "₹80 L",
      propertyType: "Apartment",
      configs: ["2 BHK"],
      possession: "Ready to Move",
    });
    const res = await request(app)
      .put(`/api/properties/${legacy._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "pending" });
    expect(res.status).toBe(200);
    expect(res.body.property.configs).toEqual(["2 BHK"]);
  });

  it("runs structured Apartment validation on updates", async () => {
    const { token } = await createAdminToken();
    const created = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(apartment());
    const invalidRows = created.body.property.configurationDetails.map((row, index) =>
      index === 0 ? { ...row, balconies: -1 } : row
    );
    const res = await request(app)
      .put(`/api/properties/${created.body.property.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ configurationDetails: invalidRows });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/balconies/i);
  });
});
