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
    possessionDetails: { status: "Under Construction", expectedCompletionDate: "2028-06" },
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

  it("allows approval when Apartment facing is not yet available", async () => {
    const { token } = await createAdminToken();
    const payload = apartment();
    payload.configurationDetails.forEach((row) => { row.facings = []; });
    const res = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send(payload);
    expect(res.status).toBe(201);
    expect(res.body.property.configurationDetails.every((row) => row.facings.length === 0)).toBe(true);
    expect(res.body.property.facing).toBe("");
  });

  it("persists interactive floor-plan rooms and structured facilities", async () => {
    const { token } = await createAdminToken();
    const payload = apartment();
    payload.configurationDetails[0] = {
      ...payload.configurationDetails[0],
      id: "unit-2bhk-a",
      builtUpArea: "1100 sqft",
      floorPlan2dUrl: "https://cdn.example.com/2bhk-plan.jpg",
      floorPlan3dUrl: "https://cdn.example.com/2bhk-plan-3d.jpg",
      rooms: [{ id: "master-bedroom", name: "Master bedroom", category: "bedroom", length: 12, width: 11, unit: "ft", polygon: [{ x: 5, y: 5 }, { x: 45, y: 5 }, { x: 45, y: 40 }, { x: 5, y: 40 }] }],
    };
    payload.facilities = [{ id: "pool", name: "Swimming Pool", category: "Wellness", description: "Temperature-controlled pool", status: "Available", hours: "6 AM - 10 PM" }];

    const res = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send(payload);

    expect(res.status).toBe(201);
    expect(res.body.property.configurationDetails[0].rooms[0]).toMatchObject({ name: "Master bedroom", length: 12, width: 11, unit: "ft" });
    expect(res.body.property.configurationDetails[0].floorPlan3dUrl).toContain("plan-3d.jpg");
    expect(res.body.property.facilities[0]).toMatchObject({ name: "Swimming Pool", category: "Wellness", status: "Available" });
  });

  it("persists structured project content and hides protected download URLs publicly", async () => {
    const { token } = await createAdminToken();
    const created = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(apartment({
        projectNarrative: {
          introduction: ["A verified project introduction."],
          usps: ["Large central green"],
          keyDetails: [{ label: "Towers", value: "8" }],
          locationAdvantage: ["Near the airport corridor"],
        },
        masterPlan: {
          imageUrl: "https://cdn.example.com/master-plan.jpg",
          title: "Project Master Plan",
          summary: "The plan places open space at the centre.",
        },
        projectDownloads: [{
          kind: "master-plan",
          label: "Master Plan",
          fileName: "master-plan.pdf",
          fileUrl: "https://res.cloudinary.com/demo/raw/upload/master-plan.pdf",
          mimeType: "application/pdf",
          fileSize: 1024,
        }],
        walkthroughVideoUrl: "https://youtu.be/dQw4w9WgXcQ?t=20",
        faqs: [{ question: "Where is the project?", answer: "Whitefield, Bangalore." }],
      }));

    expect(created.status).toBe(201);
    expect(created.body.property.projectNarrative.usps).toEqual(["Large central green"]);
    expect(created.body.property.projectDownloads[0].fileUrl).toContain("res.cloudinary.com");
    expect(created.body.property.walkthroughVideoUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

    const publicResult = await request(app).get(`/api/properties/${created.body.property.id}`);
    expect(publicResult.status).toBe(200);
    expect(publicResult.body.property.projectDownloads[0]).not.toHaveProperty("fileUrl");
    expect(publicResult.body.property.masterPlan.title).toBe("Project Master Plan");
    expect(publicResult.body.property.faqs[0].question).toBe("Where is the project?");
  });

  it("accepts property documents through 50 MB and rejects larger metadata", async () => {
    const { token } = await createAdminToken();
    const reraDocument = (fileSize) => ({
      key: "registration-certificate",
      label: "Registration Certificate",
      annexure: "Annexure 1",
      fileName: "registration.pdf",
      fileUrl: "https://res.cloudinary.com/demo/raw/upload/registration.pdf",
      mimeType: "application/pdf",
      fileSize,
    });
    const projectDownload = (fileSize) => ({
      kind: "master-plan",
      label: "Master Plan",
      fileName: "master-plan.pdf",
      fileUrl: "https://res.cloudinary.com/demo/raw/upload/master-plan.pdf",
      mimeType: "application/pdf",
      fileSize,
    });
    const withDocuments = (reraNumber, fileSize) => apartment({
      reraRegistered: true,
      reraNumber,
      reraPhases: [{ name: "Phase 1", reraNumber, reraDocuments: [reraDocument(fileSize)], projectDocuments: [] }],
      projectDownloads: [projectDownload(fileSize)],
    });

    const accepted = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send(withDocuments("PRM/KA/RERA/LIMIT5000", 50 * 1024 * 1024));
    expect(accepted.status).toBe(201);
    expect(accepted.body.property.reraPhases[0].reraDocuments[0].fileSize).toBe(50 * 1024 * 1024);
    expect(accepted.body.property.projectDownloads[0].fileSize).toBe(50 * 1024 * 1024);

    const rejected = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send(withDocuments("PRM/KA/RERA/LIMIT5001", 50 * 1024 * 1024 + 1));
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toMatch(/50 MB/i);
  });

  it("persists official RERA metadata and extended imported document categories", async () => {
    const { token } = await createAdminToken();
    const reraNumber = "PRM/KA/RERA/1251/310/PR/220922/005266";
    const document = (key, label) => ({
      key,
      label,
      fileName: `${key}.pdf`,
      fileUrl: `https://res.cloudinary.com/demo/raw/upload/${key}.pdf`,
      mimeType: "application/pdf",
      fileSize: 2048,
    });
    const res = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send(apartment({
      reraRegistered: true,
      reraNumber,
      reraPhases: [{
        name: "Phase 1",
        reraNumber,
        officialDetails: {
          promoterName: "REDDY STRUCTURES PRIVATE LIMITED",
          projectId: "9960",
          acknowledgementNumber: "ACK/KA/RERA/1251/310/PR/190822/006261",
          registrationStatus: "APPROVED",
          district: "BENGALURU URBAN",
          approvalDate: "22-09-2022",
          registeredCompletionDate: "31-03-2027",
          registeredAddress: "Katha No. 28/25/1P, Kommaghatta Village, Kengeri Hobli, Bengaluru South",
          promoterAddress: "#133/1, 2nd Floor, The Residency, Residency Road, Bengaluru 560060",
        },
        reraDocuments: [document("registration-certificate", "Registration Certificate")],
        projectDocuments: [
          document("electricity-permission-letter", "Electricity Permission Letter"),
          document("approved-layout-plan", "Approved Layout Plan"),
          document("development-agreement", "Development / Collaboration Agreement"),
          document("title-rights-document", "Rights / Title / Interest Document"),
        ],
      }],
    }));

    expect(res.status).toBe(201);
    expect(res.body.property.reraPhases[0].officialDetails).toMatchObject({
      promoterName: "REDDY STRUCTURES PRIVATE LIMITED",
      projectId: "9960",
      approvalDate: "2022-09-22",
      registeredCompletionDate: "2027-03-31",
    });
    expect(res.body.property.reraPhases[0].projectDocuments.map((row) => row.key)).toEqual([
      "electricity-permission-letter",
      "approved-layout-plan",
      "development-agreement",
      "title-rights-document",
    ]);
  });

  it("persists at most three ordered Project Overview photos", async () => {
    const { token } = await createAdminToken();
    const heroImages = [
      "https://cdn.example.com/hero-1.jpg",
      "https://cdn.example.com/hero-2.jpg",
      "https://cdn.example.com/hero-3.jpg",
    ];
    const created = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(apartment({
        heroImages,
        developerLogoUrl: "https://cdn.example.com/developer-logo.png",
        developerDescription: "Prestige Group is an established developer known for residential communities across Bengaluru.",
        localityMapImageUrl: "https://cdn.example.com/locality-map.jpg",
      }));

    expect(created.status).toBe(201);
    expect(created.body.property.heroImages).toEqual(heroImages);
    expect(created.body.property.developerLogoUrl).toContain("developer-logo.png");
    expect(created.body.property.developerDescription).toContain("established developer");
    expect(created.body.property.localityMapImageUrl).toContain("locality-map.jpg");

    const rejected = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(apartment({ heroImages: [...heroImages, "https://cdn.example.com/hero-4.jpg"] }));

    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toMatch(/maximum of 3 main photos/i);
  });

  it("accepts repeated BHK configurations", async () => {
    const { token } = await createAdminToken();
    const repeatedRow = {
      configuration: "3 BHK", price: "₹2.30 Cr", superBuiltUpArea: "1730 sqft", carpetArea: "1245 sqft",
      bedrooms: 3, bathrooms: 3, balconies: 2, facings: ["South"],
    };
    const res = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(apartment({ configs: ["3 BHK", "3 BHK", "3 BHK"], configurationDetails: [repeatedRow, repeatedRow, repeatedRow] }));

    expect(res.status).toBe(201);
    expect(res.body.property.configs).toEqual(["3 BHK", "3 BHK", "3 BHK"]);
    expect(res.body.property.configurationDetails).toHaveLength(3);
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
    ["Under Construction", { expectedCompletionDate: "2028-01" }],
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
    expect(res.body.error).toMatch(/expected completion month and year/i);
  });

  it("requires conditional RERA fields and validates project-area values", async () => {
    const { token } = await createAdminToken();
    const rera = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(apartment({ reraRegistered: true, reraNumber: "" }));
    expect(rera.status).toBe(400);
    expect(rera.body.error).toMatch(/RERA number/i);

    const area = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(apartment({ projectArea: { totalAcres: 5, openSpaceSqft: -1, builtUpSqft: 3000 } }));
    expect(area.status).toBe(400);
    expect(area.body.error).toMatch(/zero or greater/i);
  });

  it("stores component areas as square feet and moves legacy labels 1:1", async () => {
    const { token } = await createAdminToken();
    const valid = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(apartment({ projectArea: { totalAcres: 5, openSpaceSqft: 3000, builtUpSqft: 12000, amenitiesSqft: 1500 } }));
    expect(valid.status).toBe(201);
    expect(valid.body.property.projectArea).toMatchObject({ totalAcres: 5, openSpaceSqft: 3000, builtUpSqft: 12000, amenitiesSqft: 1500 });

    const legacy = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send(apartment({ title: "Legacy area labels", projectArea: { totalAcres: 5, openSpaceAcres: 3000, builtUpAcres: 12000, amenitiesAcres: 1500 } }));
    expect(legacy.status).toBe(201);
    expect(legacy.body.property.projectArea).toMatchObject({ totalAcres: 5, openSpaceSqft: 3000, builtUpSqft: 12000, amenitiesSqft: 1500 });
    expect(legacy.body.property.projectArea).not.toHaveProperty("openSpaceAcres");
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
