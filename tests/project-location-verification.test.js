const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const { createAdminToken, createUserToken } = require("./helpers");
const { parseGeocodeInput } = require("../src/services/projectLocationVerification");

function providerResponse(overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      lat: "12.969800",
      lon: "77.750000",
      osm_type: "way",
      osm_id: 4242,
      display_name: "Whitefield Main Road, Whitefield, Bengaluru, Bengaluru Urban, Karnataka, 560066, India",
      address: {
        road: "Whitefield Main Road",
        suburb: "Whitefield",
        city: "Bengaluru",
        state_district: "Bengaluru Urban",
        state: "Karnataka",
        postcode: "560066",
        country: "India",
      },
      ...overrides,
    }),
  };
}

describe("project-location verification", () => {
  it("reads coordinate pairs from decimal input and Google Maps URLs", () => {
    expect(parseGeocodeInput({ geocode: "12.9716, 77.5946" })).toMatchObject({ latitude: 12.9716, longitude: 77.5946, coordinateSource: "manual" });
    expect(parseGeocodeInput({ geocode: "https://www.google.com/maps/place/Test/@12.9698,77.75,17z" })).toMatchObject({ latitude: 12.9698, longitude: 77.75, coordinateSource: "map_url" });
  });

  it("analyzes address components and requires admin confirmation", async () => {
    const { token, admin } = await createAdminToken();
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(providerResponse());
    try {
      const analyzed = await request(app)
        .post("/api/geocoding/project-location/analyze")
        .set("Authorization", `Bearer ${token}`)
        .send({
          geocode: "12.9698, 77.75",
          locality: { address: "Whitefield Main Road", city: "Bangalore", pinCode: "560066" },
          reraAddresses: ["Whitefield Main Road, Bengaluru Urban, Karnataka 560066"],
        });
      expect(analyzed.status).toBe(200);
      expect(analyzed.body.analysis).toMatchObject({
        status: "resolved",
        inputLatitude: 12.9698,
        inputLongitude: 77.75,
        components: { city: "Bengaluru", district: "Bengaluru Urban", pinCode: "560066" },
        mismatchFields: [],
      });
      expect(analyzed.body.analysis.matchScore).toBeGreaterThan(70);

      const confirmed = await request(app)
        .post("/api/geocoding/project-location/confirm")
        .set("Authorization", `Bearer ${token}`)
        .send({ analysis: analyzed.body.analysis });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.verification).toMatchObject({ status: "admin_verified", verifiedBy: String(admin._id) });
      expect(confirmed.body.verification.verifiedAt).toBeTruthy();

      const published = await request(app)
        .post("/api/properties")
        .set("Authorization", `Bearer ${token}`)
        .send({
          title: "Verified Location Project",
          locality: { city: "Bengaluru", address: "Whitefield Main Road", pinCode: "560066", latitude: 12.9698, longitude: 77.75 },
          locationVerification: confirmed.body.verification,
        });
      expect(published.status).toBe(201);
      expect(published.body.property.locationVerification).toMatchObject({ status: "admin_verified", resolvedAddress: expect.stringContaining("Whitefield") });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("blocks confirmation when the resolved PIN code conflicts", async () => {
    const { token } = await createAdminToken();
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(providerResponse({ lat: "12.969801" }));
    try {
      const analyzed = await request(app)
        .post("/api/geocoding/project-location/analyze")
        .set("Authorization", `Bearer ${token}`)
        .send({ geocode: "12.969801, 77.75", locality: { city: "Bengaluru", pinCode: "560001" } });
      expect(analyzed.status).toBe(200);
      expect(analyzed.body.analysis.status).toBe("mismatch");
      expect(analyzed.body.analysis.mismatchFields).toContain("PIN code");

      const confirmed = await request(app)
        .post("/api/geocoding/project-location/confirm")
        .set("Authorization", `Bearer ${token}`)
        .send({ analysis: analyzed.body.analysis });
      expect(confirmed.status).toBe(409);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("allows an admin to publish while flagging unverified coordinates as a warning", async () => {
    const { token } = await createAdminToken();
    const property = await Property.create({
      title: "Unverified Map Project",
      propertyType: "Apartment",
      transactionType: "New Property",
      builder: "Builder",
      description: "A complete apartment project description that an administrator has reviewed before publication.",
      possessionDetails: { status: "Ready to Move", launchDate: "2026-01-01" },
      configurationDetails: [{ configuration: "2 BHK", price: "₹1 Cr", superBuiltUpArea: "1200 sqft", carpetArea: "900 sqft", bedrooms: 2, bathrooms: 2, balconies: 1, facings: ["East"] }],
      locality: { city: "Bengaluru", address: "Whitefield", latitude: 12.9698, longitude: 77.75 },
      status: "pending",
      published: false,
    });
    const response = await request(app)
      .patch(`/api/properties/${property._id}/workflow`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "publish" });
    expect(response.status).toBe(200);
    expect(response.body.property).toMatchObject({ status: "approved", published: true, verified: true });
    expect(response.body.property.reviewReadiness.blockers).not.toContain("Project coordinate verification");
    expect(response.body.property.reviewReadiness.warnings).toContain("Project coordinate verification");
  });

  it("invalidates verification and nearby map markers when coordinates change", async () => {
    const { token, admin } = await createAdminToken();
    const property = await Property.create({
      title: "Coordinate Change",
      status: "pending",
      published: false,
      locality: { city: "Bengaluru", address: "Whitefield", latitude: 12.9698, longitude: 77.75 },
      locationVerification: {
        status: "admin_verified",
        inputLatitude: 12.9698,
        inputLongitude: 77.75,
        resolvedAddress: "Whitefield, Bengaluru",
        provider: "nominatim",
        matchScore: 100,
        analyzedAt: new Date(),
        verifiedBy: admin._id,
        verifiedAt: new Date(),
      },
      nearbyDetails: { schools: { places: [{ name: "School", latitude: 12.97, longitude: 77.751, osmId: "node/1", resolvedAddress: "School Road", approximateDistanceMeters: 250 }] } },
    });
    const response = await request(app)
      .put(`/api/properties/${property._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "pending", locality: { city: "Bengaluru", address: "New Road", latitude: 12.98, longitude: 77.76 } });
    expect(response.status).toBe(200);
    const stored = await Property.findById(property._id).lean();
    expect(stored.locationVerification).toBeUndefined();
    expect(stored.nearbyDetails.schools.places[0].latitude).toBeUndefined();
    expect(stored.nearbyDetails.schools.places[0].osmId).toBe("");
  });

  it("does not accept forged location verification from public submissions", async () => {
    const { token } = await createUserToken();
    const response = await request(app)
      .post("/api/properties/public")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Customer Project",
        locality: { city: "Bengaluru", latitude: 12.9698, longitude: 77.75 },
        locationVerification: { status: "admin_verified", inputLatitude: 12.9698, inputLongitude: 77.75, resolvedAddress: "Forged", provider: "nominatim", analyzedAt: new Date(), verifiedAt: new Date() },
      });
    expect(response.status).toBe(201);
    expect(response.body.property.locationVerification).toBeUndefined();
  });
});
