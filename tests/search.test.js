const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");

describe("Search API", () => {
  it("filters by city and bhk", async () => {
    await Property.create({
      title: "3BHK in Whitefield",
      price: "1",
      bedrooms: 3,
      locality: { city: "Bangalore" },
    });
    await Property.create({
      title: "2BHK in Andheri",
      price: "1",
      bedrooms: 2,
      locality: { city: "Mumbai" },
    });

    const res = await request(app).get("/api/search?city=Bangalore&bhk=3");
    expect(res.status).toBe(200);
    expect(res.body.properties).toHaveLength(1);
    expect(res.body.properties[0].title).toBe("3BHK in Whitefield");
  });

  it("filters by min/max priceValue", async () => {
    await Property.create({ title: "Cheap", price: "1", priceValue: 3000000 });
    await Property.create({ title: "Expensive", price: "1", priceValue: 9000000 });

    const res = await request(app).get("/api/search?min=5000000");
    expect(res.status).toBe(200);
    expect(res.body.properties).toHaveLength(1);
    expect(res.body.properties[0].title).toBe("Expensive");
  });

  it("filters by a nested Apartment configuration bedroom count", async () => {
    await Property.create({
      title: "Multi configuration project",
      price: "1",
      bedrooms: 2,
      configurationDetails: [
        { configuration: "2 BHK", price: "1", superBuiltUpArea: "1000", carpetArea: "800", bedrooms: 2, bathrooms: 2, balconies: 1, facings: ["East"] },
        { configuration: "3 BHK", price: "2", superBuiltUpArea: "1500", carpetArea: "1200", bedrooms: 3, bathrooms: 3, balconies: 2, facings: ["South"] },
      ],
    });
    const res = await request(app).get("/api/search?bhk=3");
    expect(res.status).toBe(200);
    expect(res.body.properties.map((property) => property.title)).toContain("Multi configuration project");
  });

  it("filters by a nested Villa configuration bedroom count", async () => {
    await Property.create({
      title: "Structured Villa project",
      price: "1",
      bedrooms: 3,
      villaDetails: {
        villaType: "Row Villa",
        configurationDetails: [
          { configuration: "3 BHK", price: "1", plotArea: "2000", builtUpArea: "2500", superArea: "2800", bedrooms: 3, bathrooms: 3 },
          { configuration: "4 BHK", price: "2", plotArea: "2600", builtUpArea: "3200", superArea: "3600", bedrooms: 4, bathrooms: 4 },
        ],
        plotFacing: "East",
        cornerPlot: false,
        privateGarden: false,
        privatePool: false,
        terrace: true,
        gatedCommunity: true,
      },
    });
    const res = await request(app).get("/api/search?bhk=4");
    expect(res.status).toBe(200);
    expect(res.body.properties.map((property) => property.title)).toContain("Structured Villa project");
  });

  it("returns paginated results", async () => {
    const res = await request(app).get("/api/search?page=1&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(5);
  });
});
