const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");

function verifiedLocation(neighbourhood, city, latitude, longitude) {
  return {
    status: "admin_verified",
    coordinateSource: "manual",
    inputLatitude: latitude,
    inputLongitude: longitude,
    resolvedAddress: `${neighbourhood}, ${city}`,
    components: { neighbourhood, city },
    analyzedAt: new Date(),
  };
}

describe("Property location price comparison", () => {
  it("groups by verified locality and orders nearby areas by geographic distance rather than price similarity", async () => {
    const target = await Property.create({
      title: "Jakkur Gold",
      subtitle: "Apartment near the airport corridor",
      propertyType: "Apartment",
      listingType: "For Sale",
      status: "approved",
      published: true,
      pricePerSqft: "₹10,000 / Sq. Ft.",
      locality: { city: "Bangalore", landmark: "Thanisandra Main Road", address: "12, Example Street" },
      locationVerification: verifiedLocation("Jakkur", "Bengaluru", 13.08, 77.6),
    });
    await Property.create([
      {
        title: "Jakkur Green",
        propertyType: "Apartment",
        listingType: "For Sale",
        status: "published",
        published: true,
        price: "₹1.2 Cr",
        area: "1,000 Sq. Ft.",
        locality: { city: "Bengaluru", landmark: "Jakkur" },
      },
      {
        title: "Hebbal Premium",
        propertyType: "Apartment",
        listingType: "For Sale",
        status: "approved",
        published: true,
        pricePerSqft: "₹50,000 / Sq. Ft.",
        locality: { city: "Bengaluru", landmark: "Hebbal" },
        locationVerification: verifiedLocation("Hebbal", "Bengaluru", 13.04, 77.59),
      },
      {
        title: "Whitefield Home",
        propertyType: "Apartment",
        listingType: "For Sale",
        status: "approved",
        published: true,
        pricePerSqft: "₹11,100 / Sq. Ft.",
        locality: { city: "Bangalore Urban", landmark: "Whitefield" },
        locationVerification: verifiedLocation("Whitefield", "Bangalore Urban", 12.97, 77.75),
      },
      {
        title: "Different City",
        propertyType: "Apartment",
        listingType: "For Sale",
        status: "approved",
        published: true,
        pricePerSqft: "₹40,000 / Sq. Ft.",
        locality: { city: "Mysuru", landmark: "Jakkur" },
        locationVerification: verifiedLocation("Jakkur", "Mysuru", 12.3, 76.6),
      },
    ]);

    const response = await request(app).get(`/api/properties/price-comparison/${target._id}`);

    expect(response.status).toBe(200);
    expect(response.body.currentLocation).toBe("Jakkur");
    expect(response.body.comparisonBasis).toBe("verified_nearby_localities");
    expect(response.body.comparisons.map((item) => item.key)).toEqual(["jakkur", "hebbal", "whitefield"]);
    expect(response.body.comparisons[0]).toEqual(expect.objectContaining({ averagePricePerSqft: 11000, projectCount: 2, distanceKm: 0 }));
    expect(response.body.comparisons[1].distanceKm).toBeLessThan(response.body.comparisons[2].distanceKm);
    expect(response.body.comparisons.some((item) => item.averagePricePerSqft === 40000)).toBe(false);
  });

  it("does not claim a nearby comparison when the current project coordinates are unverified", async () => {
    const target = await Property.create({
      title: "Unverified Location",
      propertyType: "Apartment",
      listingType: "For Sale",
      status: "approved",
      published: true,
      pricePerSqft: "₹10,000 / Sq. Ft.",
      locality: { city: "Bengaluru", landmark: "Jakkur", latitude: 13.08, longitude: 77.6 },
    });
    await Property.create({
      title: "Verified Nearby Home",
      propertyType: "Apartment",
      listingType: "For Sale",
      status: "approved",
      published: true,
      pricePerSqft: "₹12,000 / Sq. Ft.",
      locality: { city: "Bengaluru", landmark: "Hebbal" },
      locationVerification: verifiedLocation("Hebbal", "Bengaluru", 13.04, 77.59),
    });

    const response = await request(app).get(`/api/properties/price-comparison/${target._id}`);

    expect(response.status).toBe(200);
    expect(response.body.comparisonBasis).toBe("nearby_data_unavailable");
    expect(response.body.comparisons).toHaveLength(1);
    expect(response.body.comparisons[0].key).toBe("jakkur");
  });
});
