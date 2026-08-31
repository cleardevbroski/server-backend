const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const PropertyImportBatch = require("../src/models/PropertyImportBatch");
const { parsePropertyTemplate } = require("../src/services/propertyTemplateParser");
const { createAdminToken, createUserToken } = require("./helpers");

describe("property folder import reports", () => {
  it("keeps reports admin-only and returns package records separately", async () => {
    const batch = await PropertyImportBatch.create({
      batchKey: "remaining-rows",
      name: "remaining_rows",
      packageCount: 1,
      importedCount: 1,
      status: "completed",
      records: [{ packageKey: "one.zip::100", packageName: "one.zip", projectName: "Project One", status: "imported" }],
    });
    expect((await request(app).get("/api/property-import-batches")).status).toBe(401);
    const { token: userToken } = await createUserToken();
    expect((await request(app).get("/api/property-import-batches").set("Authorization", `Bearer ${userToken}`)).status).toBe(403);
    const { token } = await createAdminToken();
    const list = await request(app).get("/api/property-import-batches").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.batches[0]).toMatchObject({ name: "remaining_rows", packageCount: 1 });
    expect(list.body.batches[0]).not.toHaveProperty("records");
    const detail = await request(app).get(`/api/property-import-batches/${batch._id}`).set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.batch.records[0]).toMatchObject({ packageName: "one.zip", projectName: "Project One" });
  });

  it("shows repeated RERA numbers without merging their projects", async () => {
    const batch = await PropertyImportBatch.create({
      batchKey: "rera-review",
      name: "RERA review",
      packageCount: 2,
      sharedReraNumbers: [{ reraNumber: "PRM/KA/TEST/001", projects: ["Alpha", "Beta"] }],
      records: [
        { packageKey: "alpha.zip::1", packageName: "alpha.zip", projectName: "Alpha" },
        { packageKey: "beta.zip::1", packageName: "beta.zip", projectName: "Beta" },
      ],
    });
    await Property.create({ title: "Alpha", status: "recheck", published: false, bulkImport: { packageKey: "alpha.zip::1", batchKey: batch.batchKey } });
    await Property.create({ title: "Beta", status: "recheck", published: false, bulkImport: { packageKey: "beta.zip::1", batchKey: batch.batchKey } });
    const { token } = await createAdminToken();
    const response = await request(app).get("/api/property-import-batches/rera-conflicts").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.conflicts).toHaveLength(1);
    expect(response.body.conflicts[0]).toMatchObject({ reraNumber: "PRM/KA/TEST/001", projectNames: ["Alpha", "Beta"] });
    expect(response.body.conflicts[0].properties.map((property) => property.title).sort()).toEqual(["Alpha", "Beta"]);
  });
});

describe("staged property template parser", () => {
  it("preserves configurations, every RERA phase, official details and project content", () => {
    const staged = {
      propertyUploadText: `[PROPERTY BASICS]\nProperty Type: Apartment\nProject / Property Name: Project One\nBuilder / Developer: Builder One\nTransaction Type: New Property\nListing Type: For Sale\n\n[RERA]\nRERA Registered: Yes\n\n[RERA PHASE]\nPhase Name: Phase A\nRERA Number: PRM/KA/A\n\n[RERA PHASE]\nPhase Name: Phase B\nRERA Number: PRM/KA/B\n\n[CONFIGURATION]\nConfiguration Name: 2 BHK\nPrice: ₹ 1 Cr\nBuilt-up Area: 1200 Sq. Ft.\nCarpet Area: 900 Sq. Ft.\nBedrooms: 2\nBathrooms: 2\nBalconies: 1\nFacings: East, North\n\n[PROJECT INTRODUCTION]\nParagraph: Verified introduction.\n\n[WHY INVEST]\nReason: Limited inventory.\n\n[FAQ]\nQuestion: Where is the project?\nAnswer: Bengaluru.`,
      projectData: {},
      validation: { warnings: [] },
      reraPhases: [
        { projectDetails: { rera_number: "PRM/KA/A", promoter_name: "Official Promoter A", project_id: "100" } },
        { projectDetails: { rera_number: "PRM/KA/B", promoter_name: "Official Promoter B", project_id: "200" } },
      ],
    };
    const { payload } = parsePropertyTemplate(staged);
    expect(payload.configurationDetails).toHaveLength(1);
    expect(payload.configurationDetails[0]).toMatchObject({ configuration: "2 BHK", builtUpArea: "1200 Sq. Ft.", facings: ["East", "North"] });
    expect(payload.reraPhases).toHaveLength(2);
    expect(payload.reraPhases[1]).toMatchObject({ name: "Phase B", reraNumber: "PRM/KA/B", officialDetails: { promoterName: "Official Promoter B", projectId: "200" } });
    expect(payload.projectNarrative.introduction).toEqual(["Verified introduction."]);
    expect(payload.projectNarrative.investmentReasons).toEqual(["Limited inventory."]);
    expect(payload.faqs).toHaveLength(1);
  });
});
