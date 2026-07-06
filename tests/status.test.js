const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const { createAdminToken } = require("./helpers");

describe("Property status workflow", () => {
  it("defaults status to approved on direct create", async () => {
    const p = await Property.create({ title: "P", price: "1" });
    expect(p.status).toBe("approved");
  });

  it("forces status=pending on public submissions even if the body says otherwise", async () => {
    const res = await request(app)
      .post("/api/properties/public")
      .send({ title: "P", price: "1", status: "approved" });
    expect(res.status).toBe(201);
    expect(res.body.property.status).toBe("pending");
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

  it("rejects invalid status values", async () => {
    const { token } = await createAdminToken();
    const p = await Property.create({ title: "P", price: "1" });

    const res = await request(app)
      .put(`/api/properties/${p._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "archived" });
    expect(res.status).toBe(500);
    const fresh = await Property.findById(p._id);
    expect(fresh.status).toBe("approved");
  });
});
