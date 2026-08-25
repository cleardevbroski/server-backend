const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const { createAdminToken, createUserToken } = require("./helpers");

function villa(overrides = {}) {
  return {
    title: "Windmills Villa Estate",
    subtitle: "Sarjapur Road, Bangalore",
    price: "₹95 L",
    propertyType: "Villa",
    configs: ["3 BHK", "4 BHK"],
    villaDetails: {
      villaType: "Independent",
      configurationDetails: [
        {
          configuration: "3 BHK",
          price: "₹95 L",
          plotArea: "2400 sqft",
          builtUpArea: "3200 sqft",
          superArea: "3600 sqft",
          bedrooms: 3,
          bathrooms: 3,
        },
        {
          configuration: "4 BHK",
          price: "₹2.80 Cr",
          plotArea: "3000 sqft",
          builtUpArea: "4100 sqft",
          superArea: "4600 sqft",
          bedrooms: 4,
          bathrooms: 4,
        },
      ],
      plotDimensions: "40 ft x 60 ft",
      numberOfFloors: "g + 2",
      plotFacing: "East",
      cornerPlot: false,
      roadWidthFacing: "30 ft road",
      privateGarden: true,
      privateGardenArea: "400 sqft",
      privatePool: false,
      terrace: true,
      terraceDetails: "Private terrace access",
      gatedCommunity: true,
    },
    possessionDetails: { status: "Under Construction", expectedCompletionDate: "2028-12-01" },
    furnishing: "Semi-Furnished",
    builder: "Total Environment",
    transactionType: "New Property",
    listingType: "For Sale",
    locality: { city: "Bangalore", pinCode: "560066" },
    ...overrides,
  };
}

describe("Villa property workflow", () => {
  it("normalizes Villa rows and derives legacy summaries", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(villa({ configs: ["3bhk", "4 BHK"] }));

    expect(res.status).toBe(201);
    expect(res.body.property.configs).toEqual(["3 BHK", "4 BHK"]);
    expect(res.body.property.price).toBe("₹95 L - ₹2.80 Cr");
    expect(res.body.property.area).toBe("3600 sqft - 4600 sqft");
    expect(res.body.property.bedrooms).toBe(3);
    expect(res.body.property.facing).toBe("East");
    expect(res.body.property.villaDetails.plotDimensions).toBe("40 ft × 60 ft");
    expect(res.body.property.villaDetails.numberOfFloors).toBe("G+2");
  });

  it("allows approval when Villa facing is not yet available", async () => {
    const { token } = await createAdminToken();
    const payload = villa();
    delete payload.villaDetails.plotFacing;
    const res = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send(payload);
    expect(res.status).toBe(201);
    expect(res.body.property.villaDetails.plotFacing).toBeUndefined();
    expect(res.body.property.facing).toBe("");
  });

  it("accepts repeated BHK configurations", async () => {
    const { token } = await createAdminToken();
    const repeatedRow = {
      configuration: "3 BHK", price: "₹95 L", plotArea: "2400 sqft", builtUpArea: "3200 sqft",
      superArea: "3600 sqft", bedrooms: 3, bathrooms: 3,
    };
    const payload = villa({ configs: ["3 BHK", "3 BHK", "3 BHK"] });
    payload.villaDetails.configurationDetails = [repeatedRow, repeatedRow, repeatedRow];
    const res = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.property.configs).toEqual(["3 BHK", "3 BHK", "3 BHK"]);
    expect(res.body.property.villaDetails.configurationDetails).toHaveLength(3);
  });

  it("rejects mismatched tags and rows", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(villa({ configs: ["3 BHK", "5 BHK"] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tags and Villa detail rows/i);
  });

  it("rejects a bedroom count inconsistent with its BHK label", async () => {
    const { token } = await createAdminToken();
    const payload = villa();
    payload.villaDetails.configurationDetails[0].bedrooms = 2;
    const res = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bedrooms must equal 3/i);
  });

  it.each([
    ["Ready to Move", { launchDate: "2024-01-15" }],
    ["Under Construction", { expectedCompletionDate: "2028-01-15" }],
  ])("accepts %s with only its matching date", async (status, dates) => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(villa({ possessionDetails: { status, ...dates } }));
    expect(res.status).toBe(201);
    expect(res.body.property.possessionDetails.status).toBe(status);
  });

  it("rejects stale Villa possession dates", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(villa({ possessionDetails: { status: "Ready to Move", launchDate: "2024-01-15", expectedCompletionDate: "2028-01-15" } }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Ready Since date/i);
  });

  it("requires and clears conditional garden data", async () => {
    const { token } = await createAdminToken();
    const missing = villa();
    missing.villaDetails.privateGardenArea = "";
    const invalid = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(missing);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatch(/garden area/i);

    const noGarden = villa();
    noGarden.villaDetails.privateGarden = false;
    const valid = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(noGarden);
    expect(valid.status).toBe(201);
    expect(valid.body.property.villaDetails.privateGardenArea).toBe("");
  });

  it("requires a broad-format RERA number only when registered", async () => {
    const { token } = await createAdminToken();
    const invalid = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(villa({ reraRegistered: true, reraNumber: "bad value" }));
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatch(/8-50 characters/i);

    const valid = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(villa({ reraRegistered: true, reraNumber: "PRM/KA/RERA/12345" }));
    expect(valid.status).toBe(201);
  });

  it("matches nested Villa bedrooms in public property filtering", async () => {
    await Property.create(villa({ status: "approved" }));
    const res = await request(app).get("/api/properties?bedrooms=4");
    expect(res.status).toBe(200);
    expect(res.body.properties.map((property) => property.title)).toContain("Windmills Villa Estate");
  });

  it("keeps legacy Villas readable and moderation-updatable", async () => {
    const { token } = await createAdminToken();
    const legacy = await Property.create({
      title: "Legacy Villa",
      price: "₹1 Cr",
      propertyType: "Villa",
      configs: ["3 BHK"],
      possession: "Ready to Move",
    });
    const res = await request(app)
      .put(`/api/properties/${legacy._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "pending" });
    expect(res.status).toBe(200);
    expect(res.body.property.configs).toEqual(["3 BHK"]);
  });

  it("runs structured Villa validation on updates", async () => {
    const { token } = await createAdminToken();
    const created = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(villa());
    const details = created.body.property.villaDetails;
    details.configurationDetails[0].bathrooms = 0;
    const res = await request(app)
      .put(`/api/properties/${created.body.property.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ villaDetails: details });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/bathrooms/i);
  });

  it("removes Apartment-only structured data when converting to Villa", async () => {
    const { token } = await createAdminToken();
    const apartment = await Property.create({
      title: "Convertible Home",
      price: "₹1 Cr",
      propertyType: "Apartment",
      configurationDetails: [{ configuration: "2 BHK", price: "₹1 Cr", superBuiltUpArea: "1200 sqft", carpetArea: "900 sqft", bedrooms: 2, bathrooms: 2, balconies: 1, facings: ["East"] }],
    });
    const res = await request(app)
      .put(`/api/properties/${apartment._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send(villa({ title: undefined }));
    expect(res.status).toBe(200);
    expect(res.body.property.villaDetails.configurationDetails).toHaveLength(2);
    expect(res.body.property.configurationDetails).toBeUndefined();
  });

  it("removes Villa-only structured data when converting to a generic property type", async () => {
    const { token } = await createAdminToken();
    const created = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(villa());
    const res = await request(app)
      .put(`/api/properties/${created.body.property.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ propertyType: "Penthouse", price: "₹3 Cr", area: "3000 sqft", configs: ["4 BHK"] });
    expect(res.status).toBe(200);
    expect(res.body.property.propertyType).toBe("Penthouse");
    expect(res.body.property.villaDetails).toBeUndefined();
    expect(res.body.property.possessionDetails).toBeUndefined();
  });

  it("puts authenticated public Villa submissions into the submitted moderation queue", async () => {
    const { token } = await createUserToken();
    const res = await request(app).post("/api/properties/public").set("Authorization", `Bearer ${token}`).send(villa());
    expect(res.status).toBe(201);
    expect(res.body.property.status).toBe("submitted");
    expect(res.body.property.published).toBe(false);
    expect(res.body.property.villaDetails.configurationDetails).toHaveLength(2);
  });
});
