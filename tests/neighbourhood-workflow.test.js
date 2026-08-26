const request = require("supertest");
const app = require("../src/app");
const { createUserToken } = require("./helpers");

describe("cross-property locality and neighbourhood workflow", () => {
  it("persists multiple colleges and hospitals for every supported property type", async () => {
    const { token } = await createUserToken();
    const nearbyDetails = {
      colleges: {
        places: [
          { name: "City Engineering College", address: "Main Road", distance: "1.2 km", landmark: "Near Metro Gate", latitude: 12.9716, longitude: 77.5946, osmId: "node/42", mapUrl: "https://www.google.com/maps/search/?api=1&query=12.9716,77.5946", resolvedAddress: "Main Road, Bangalore", approximateDistanceMeters: 1250 },
          { name: "National Degree College", distance: "2.5 km" },
        ],
      },
      hospitals: {
        places: [
          { name: "City Hospital", address: "Lake Road", distance: "800 m" },
          { name: "Community Clinic", landmark: "Opposite Bus Stand" },
        ],
      },
    };

    for (const propertyType of ["Apartment", "Villa", "Plot", "Commercial", "PG/Co-living"]) {
      const response = await request(app)
        .post("/api/properties/public")
        .set("Authorization", `Bearer ${token}`)
        .send({
          propertyType,
          title: `${propertyType} neighbourhood test`,
          locality: { city: "Bangalore", address: "Whitefield Main Road", latitude: 12.9698, longitude: 77.75 },
          nearbyDetails,
        });

      expect(response.status).toBe(201);
      expect(response.body.property.locality.address).toBe("Whitefield Main Road");
      expect(response.body.property.locality).toMatchObject({ latitude: 12.9698, longitude: 77.75 });
      expect(response.body.property.nearbyDetails.colleges.places).toHaveLength(2);
      expect(response.body.property.nearbyDetails.hospitals.places).toHaveLength(2);
      expect(response.body.property.nearbyDetails.colleges.places[0]).toMatchObject({
        name: "City Engineering College",
        address: "Main Road",
        distance: "1.2 km",
        landmark: "Near Metro Gate",
        latitude: 12.9716,
        longitude: 77.5946,
        osmId: "node/42",
        approximateDistanceMeters: 1250,
      });
    }
  });
});
