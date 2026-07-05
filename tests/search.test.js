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

  it("returns paginated results", async () => {
    const res = await request(app).get("/api/search?page=1&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(5);
  });
});
