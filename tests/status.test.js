const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const { createAdminToken, createUserToken } = require("./helpers");

describe("Property status workflow", () => {
  it("defaults status to approved on direct create", async () => {
    const p = await Property.create({ title: "P", price: "1" });
    expect(p.status).toBe("approved");
  });

  it("forces status=submitted on authenticated public submissions even if the body says otherwise", async () => {
    const { token } = await createUserToken();
    const res = await request(app)
      .post("/api/properties/public")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "P", price: "1", status: "approved" });
    expect(res.status).toBe(201);
    expect(res.body.property.status).toBe("submitted");
    expect(res.body.property.published).toBe(false);
  });

  it("public list returns only approved properties", async () => {
    await Property.create({ title: "Approved", price: "1", status: "approved" });
    await Property.create({ title: "Pending", price: "1", status: "pending" });
    await Property.create({ title: "Rejected", price: "1", status: "rejected" });

    const res = await request(app).get("/api/properties");
    expect(res.status).toBe(200);
    const titles = res.body.properties.map((p) => p.title);
    expect(titles).toContain("Approved");
    expect(titles).not.toContain("Pending");
    expect(titles).not.toContain("Rejected");
  });

  it("public list includes legacy docs without status unless unpublished", async () => {
    const legacy = await Property.create({ title: "Legacy", price: "1" });
    await Property.updateOne({ _id: legacy._id }, { $unset: { status: "" } });
    const hidden = await Property.create({ title: "Hidden", price: "1", published: false });
    await Property.updateOne({ _id: hidden._id }, { $unset: { status: "" } });

    const res = await request(app).get("/api/properties");
    expect(res.status).toBe(200);
    const titles = res.body.properties.map((p) => p.title);
    expect(titles).toContain("Legacy");
    expect(titles).not.toContain("Hidden");
  });

  it("admin can transition status through the update route", async () => {
    const { token } = await createAdminToken();
    const p = await Property.create({ title: "P", price: "1", status: "pending" });

    const approve = await request(app)
      .put(`/api/properties/${p._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "approved" });
    expect(approve.status).toBe(200);
    expect(approve.body.property.status).toBe("approved");

    const reject = await request(app)
      .put(`/api/properties/${p._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "rejected" });
    expect(reject.status).toBe(200);
    expect(reject.body.property.status).toBe("rejected");
  });

  it("lets admins save incomplete listings as pending and keeps them private", async () => {
    const { token } = await createAdminToken();
    const created = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Incomplete Apartment", propertyType: "Apartment", configurationDetails: [{ configuration: "2 BHK" }], status: "pending", published: false });
    expect(created.status).toBe(201);
    expect(created.body.property.status).toBe("pending");
    expect(created.body.property.published).toBe(false);

    const publicResponse = await request(app).get(`/api/properties/${created.body.property.id}`);
    expect(publicResponse.status).toBe(404);

    const published = await request(app)
      .put(`/api/properties/${created.body.property.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "approved", published: true });
    expect(published.status).toBe(200);
    expect(published.body.property.status).toBe("approved");
    expect(published.body.property.published).toBe(true);
  });

  it("rejects invalid status values", async () => {
    const { token } = await createAdminToken();
    const p = await Property.create({ title: "P", price: "1" });

    const res = await request(app)
      .put(`/api/properties/${p._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "archived" });
    expect(res.status).toBe(400);
    const fresh = await Property.findById(p._id);
    expect(fresh.status).toBe("approved");
  });

  it("imports ZIP packages into a separate idempotent recheck queue", async () => {
    const { token } = await createAdminToken();
    const packageInfo = {
      packageName: "Project One.zip",
      packageSize: 1024,
      packageKey: "project one.zip::1024",
      batchName: "August batch",
    };

    const preflight = await request(app)
      .post("/api/properties/admin/recheck-imports/preflight")
      .set("Authorization", `Bearer ${token}`)
      .send({ packages: [packageInfo] });
    expect(preflight.status).toBe(200);
    expect(preflight.body).toMatchObject({ newCount: 1, existingCount: 0 });

    const created = await request(app)
      .post("/api/properties/admin/recheck-imports")
      .set("Authorization", `Bearer ${token}`)
      .send({ package: packageInfo, property: { title: "Project One", propertyType: "Apartment" } });
    expect(created.status).toBe(201);
    expect(created.body.property).toMatchObject({ title: "Project One", status: "recheck", published: false, verified: false });

    const retried = await request(app)
      .post("/api/properties/admin/recheck-imports")
      .set("Authorization", `Bearer ${token}`)
      .send({ package: packageInfo, property: { title: "Duplicate" } });
    expect(retried.status).toBe(200);
    expect(retried.body.skipped).toBe(true);
    expect(await Property.countDocuments({ "bulkImport.packageKey": packageInfo.packageKey })).toBe(1);

    const publicResponse = await request(app).get(`/api/properties/${created.body.property.id}`);
    expect(publicResponse.status).toBe(404);
  });

  it("moves a recheck import to Pending without changing existing Pending properties", async () => {
    const { token } = await createAdminToken();
    const existingPending = await Property.create({ title: "Existing Pending", status: "pending", published: false });
    const imported = await Property.create({ title: "Imported", status: "recheck", published: false });

    const moved = await request(app)
      .patch(`/api/properties/admin/recheck-imports/${imported._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "move_to_pending" });
    expect(moved.status).toBe(200);
    expect(moved.body.property.status).toBe("pending");
    expect((await Property.findById(existingPending._id)).status).toBe("pending");
  });

  it("keeps status, publication and verification flags consistent through admin workflow actions", async () => {
    const { token } = await createAdminToken();
    const property = await Property.create({
      title: "Workflow Apartment",
      builder: "Workflow Builder",
      propertyType: "Apartment",
      transactionType: "New Property",
      description: "A complete workflow apartment description with enough verified project information for publishing.",
      possessionDetails: { status: "Ready to Move", launchDate: "2026-01-01" },
      reraRegistered: false,
      status: "pending",
      published: false,
      verified: false,
      submittedBy: "admin",
      configurationDetails: [{ configuration: "2 BHK", price: "₹1 Cr", superBuiltUpArea: "1200 sqft", carpetArea: "900 sqft", bedrooms: 2, bathrooms: 2, balconies: 1, facings: ["East"] }],
    });

    const published = await request(app)
      .patch(`/api/properties/${property._id}/workflow`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "publish" });
    expect(published.status).toBe(200);
    expect(published.body.property).toMatchObject({ status: "approved", published: true, verified: true });
    expect(published.body.property.workflowHistory).toHaveLength(1);
    expect(published.body.property.workflowHistory[0]).toMatchObject({ fromStatus: "pending", toStatus: "approved", action: "publish" });

    const pending = await request(app)
      .patch(`/api/properties/${property._id}/workflow`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "move_to_pending" });
    expect(pending.status).toBe(200);
    expect(pending.body.property).toMatchObject({ status: "pending", published: false, verified: false });
    expect(pending.body.property.workflowHistory).toHaveLength(2);
  });

  it("blocks publishing when required admin review checks are missing", async () => {
    const { token } = await createAdminToken();
    const property = await Property.create({ title: "Incomplete Import", propertyType: "Apartment", status: "recheck", published: false, submittedBy: "admin" });

    const response = await request(app)
      .patch(`/api/properties/${property._id}/workflow`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "publish" });

    expect(response.status).toBe(422);
    expect(response.body.readiness.canPublish).toBe(false);
    expect(response.body.readiness.blockers).toEqual(expect.arrayContaining(["Builder / developer", "Type-specific configuration"]));
    expect((await Property.findById(property._id)).status).toBe("recheck");
  });

  it("includes review readiness on authenticated admin property lists", async () => {
    const { token } = await createAdminToken();
    await Property.create({ title: "Readiness Import", propertyType: "Apartment", status: "recheck", published: false, submittedBy: "admin" });
    const response = await request(app).get("/api/properties/admin?status=recheck").set("Authorization", `Bearer ${token}`);
    expect(response.body.error).toBeUndefined();
    expect(response.status).toBe(200);
    expect(response.body.properties[0].reviewReadiness).toMatchObject({ canPublish: false });
  });

  it("publishes imported projects without discarding portal-specific RERA document keys", async () => {
    const { token } = await createAdminToken();
    const property = await Property.create({
      title: "Imported RERA Apartment",
      builder: "RERA Builder",
      propertyType: "Apartment",
      transactionType: "New Property",
      description: "A complete imported apartment description containing verified project information for publishing.",
      possessionDetails: { status: "Ready to Move", launchDate: "2026-01-01" },
      status: "recheck",
      published: false,
      submittedBy: "admin",
      bulkImport: { packageKey: "rera-project.zip::100", packageName: "RERA Project.zip", packageSize: 100, batchKey: "test-batch", importState: "complete" },
      configurationDetails: [{ configuration: "2 BHK", price: "₹1 Cr", superBuiltUpArea: "1200 sqft", carpetArea: "900 sqft", bedrooms: 2, bathrooms: 2, balconies: 1, facings: ["East"] }],
      reraRegistered: true,
      reraNumber: "PRM/KA/RERA/12345678",
      reraPhases: [{
        name: "Phase 1",
        reraNumber: "PRM/KA/RERA/12345678",
        reraDocuments: [{ key: "rera-registration-certificate-5", label: "RERA Registration Certificate", fileName: "certificate.pdf", fileUrl: "https://res.cloudinary.com/demo/raw/upload/certificate.pdf", mimeType: "application/pdf", fileSize: 1024 }],
        projectDocuments: [{ key: "portal-project-plan-6", label: "Portal Project Plan", fileName: "plan.pdf", fileUrl: "https://res.cloudinary.com/demo/raw/upload/plan.pdf", mimeType: "application/pdf", fileSize: 2048 }],
      }],
    });

    const response = await request(app)
      .patch(`/api/properties/${property._id}/workflow`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "publish" });

    expect(response.body.error).toBeUndefined();
    expect(response.status).toBe(200);
    expect(response.body.property.reraPhases[0].reraDocuments[0].key).toBe("rera-registration-certificate-5");
    expect(response.body.property.reraPhases[0].projectDocuments[0].key).toBe("portal-project-plan-6");
    expect(typeof response.body.property._id).toBe("string");
    expect(typeof response.body.property.reraPhases[0]._id).toBe("string");
    expect(typeof response.body.property.reraPhases[0].reraDocuments[0]._id).toBe("string");
    expect(typeof response.body.property.reraPhases[0].projectDocuments[0]._id).toBe("string");
    expect(typeof response.body.property.reviewedBy).toBe("string");
    expect(typeof response.body.property.workflowHistory[0].actor).toBe("string");
  });

  it("lets an admin publish reviewed imports with half-BHK labels and unavailable optional configuration facts", async () => {
    const { token } = await createAdminToken();
    const property = await Property.create({
      title: "Reviewed Imported Apartment",
      builder: "Imported Builder",
      propertyType: "Apartment",
      transactionType: "New Property",
      description: "An imported apartment project whose available source facts have been reviewed by an administrator.",
      possessionDetails: { status: "Under Construction", expectedCompletionDate: "" },
      status: "recheck",
      published: false,
      submittedBy: "admin",
      bulkImport: { packageKey: "reviewed.zip::100", packageName: "reviewed.zip", packageSize: 100, batchKey: "reviewed-batch", importState: "complete" },
      configs: ["3.5 BHK"],
      configurationDetails: [{ configuration: "3.5 BHK", builtUpArea: "1800 Sq. Ft.", bedrooms: 3, facings: [] }],
    });

    const response = await request(app)
      .patch(`/api/properties/${property._id}/workflow`)
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "publish" });

    expect(response.status).toBe(200);
    expect(response.body.property).toMatchObject({ status: "approved", published: true, verified: true });
    expect(response.body.property.configurationDetails[0]).toMatchObject({ configuration: "3.5 BHK", builtUpArea: "1800 Sq. Ft." });
    expect(response.body.property.reviewReadiness.warnings).toEqual(expect.arrayContaining(["Configuration prices", "Configuration carpet areas", "Configuration bathroom and balcony counts", "Possession timeline"]));
  });
});

describe("GET /api/properties/:id", () => {
  it("returns approved and legacy properties, but 404 for pending/rejected (DBG010)", async () => {
    const approved = await Property.create({ title: "Approved Villa", price: "1", status: "approved" });
    const pending = await Property.create({ title: "Pending Villa", price: "1", status: "pending" });
    const rejected = await Property.create({ title: "Rejected Villa", price: "1", status: "rejected" });
    const legacy = await Property.create({ title: "Legacy Villa", price: "1" }); // no status field

    const approvedRes = await request(app).get(`/api/properties/${approved._id}`);
    expect(approvedRes.status).toBe(200);
    expect(approvedRes.body.property.title).toBe("Approved Villa");

    // Pending properties should NOT be publicly accessible
    const pendingRes = await request(app).get(`/api/properties/${pending._id}`);
    expect(pendingRes.status).toBe(404);

    // Rejected properties should NOT be publicly accessible
    const rejectedRes = await request(app).get(`/api/properties/${rejected._id}`);
    expect(rejectedRes.status).toBe(404);

    // Legacy docs without status should still be visible
    const legacyRes = await request(app).get(`/api/properties/${legacy._id}`);
    expect(legacyRes.status).toBe(200);
    expect(legacyRes.body.property.title).toBe("Legacy Villa");
  });

  it("returns 404 for a well-formed id that doesn't exist", async () => {
    const missingId = "64b7f3f3f3f3f3f3f3f3f3f3";
    const res = await request(app).get(`/api/properties/${missingId}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Property not found");
  });

  it("returns 404 (not 500) for a malformed id", async () => {
    const res = await request(app).get("/api/properties/not-a-valid-object-id");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Property not found");
  });
});
