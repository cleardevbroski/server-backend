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
