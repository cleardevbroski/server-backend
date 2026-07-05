const request = require("supertest");
const app = require("../src/app");
const Lead = require("../src/models/Lead");
const { createAdminToken } = require("./helpers");

describe("Leads API", () => {
  it("creates a contact lead", async () => {
    const res = await request(app)
      .post("/api/leads/contact")
      .send({ name: "Asha", email: "asha@example.com", message: "Interested in a 3BHK" });
    expect(res.status).toBe(201);
    expect(res.body.lead.type).toBe("contact");
    expect(res.body.lead.status).toBe("new");
  });

  it("creates a consultation lead", async () => {
    const res = await request(app)
      .post("/api/leads/consultation")
      .send({ name: "Ravi", phone: "9876543210", category: "Title Verification" });
    expect(res.status).toBe(201);
    expect(res.body.lead.type).toBe("consultation");
  });

  it("rejects contact lead missing required fields", async () => {
    const res = await request(app).post("/api/leads/contact").send({ name: "" });
    expect(res.status).toBe(400);
  });

  it("rejects listing leads without an admin token", async () => {
    const res = await request(app).get("/api/leads");
    expect(res.status).toBe(401);
  });

  it("lists leads for an admin, filterable by status", async () => {
    const { token } = await createAdminToken();
    await Lead.create({ type: "contact", name: "A", status: "new" });
    await Lead.create({ type: "contact", name: "B", status: "closed" });
    const res = await request(app)
      .get("/api/leads?status=closed")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.leads).toHaveLength(1);
    expect(res.body.leads[0].name).toBe("B");
  });

  it("updates a lead's status", async () => {
    const { token } = await createAdminToken();
    const lead = await Lead.create({ type: "contact", name: "A" });
    const res = await request(app)
      .patch(`/api/leads/${lead._id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "contacted" });
    expect(res.status).toBe(200);
    expect(res.body.lead.status).toBe("contacted");
  });
});
