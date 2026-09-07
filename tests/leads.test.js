const request = require("supertest");
const app = require("../src/app");
const Lead = require("../src/models/Lead");
const Lawyer = require("../src/models/Lawyer");
const { createAdminToken, createUserToken } = require("./helpers");

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

  it("records an authenticated property consultation and returns the selected lawyer WhatsApp link", async () => {
    const { token, user } = await createUserToken();
    user.name = "Ravi Kumar";
    user.email = "ravi@example.com";
    await user.save();
    const lawyer = await Lawyer.create({
      name: "Adv. Meera Rao",
      qualification: "B.A. LL.B.",
      college: "National Law School",
      experience: "12 years",
      barCouncil: "KA/100/2014",
      rating: 4.8,
      cases: "180+",
      specialty: "Title Verification",
      languages: "English, Kannada",
      city: "Bengaluru",
      whatsappNumber: "+919876543210",
      legalDocumentType: "Bar Council Enrollment Certificate",
      legalDocumentNumber: "KA/100/2014",
      legalDocumentUrl: "https://cdn.example.com/certificate.pdf",
      status: "approved",
    });

    const res = await request(app)
      .post("/api/leads/consultation/property")
      .set("Authorization", `Bearer ${token}`)
      .send({
        lawyerId: lawyer._id.toString(),
        propertyId: "property-123",
        propertyTitle: "Lakeview Heights",
        propertyLocation: "Whitefield, Bengaluru",
        propertyUrl: "https://cleartitle.example/property/property-123",
        category: "Title deed verification",
        message: "Please verify the ownership chain and title deed.",
      });

    expect(res.status).toBe(201);
    expect(res.body.lead).toMatchObject({
      type: "consultation",
      lawyerName: "Adv. Meera Rao",
      propertyId: "property-123",
      phone: user.phone,
    });
    expect(res.body.whatsappUrl).toContain("https://wa.me/919876543210?text=");
    expect(decodeURIComponent(res.body.whatsappUrl)).toContain("Lakeview Heights");
  });

  it("requires customer authentication for a property consultation", async () => {
    const res = await request(app).post("/api/leads/consultation/property").send({});
    expect(res.status).toBe(401);
  });

  it("records a verified property brochure request", async () => {
    const { token, user } = await createUserToken();
    const res = await request(app)
      .post("/api/leads/property-interest")
      .set("Authorization", `Bearer ${token}`)
      .send({
        propertyId: "property-123",
        propertyTitle: "Lakeview Heights",
        audience: "buyer",
        budget: "₹80 L - ₹1 Cr",
        phone: user.phone,
        action: "brochure",
      });
    expect(res.status).toBe(201);
    expect(res.body.lead).toMatchObject({ type: "property_interest", audience: "buyer", action: "brochure", phone: user.phone });
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

  it("searches lead identity and property fields with pagination metadata", async () => {
    const { token } = await createAdminToken();
    await Lead.create({ type: "property_interest", name: "Meera Rao", phone: "9876543210", propertyTitle: "Sobha Galera" });
    await Lead.create({ type: "contact", name: "Arun", email: "arun@example.com" });

    const res = await request(app)
      .get("/api/leads?search=Galera&page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.leads).toHaveLength(1);
    expect(res.body.leads[0]).toMatchObject({ name: "Meera Rao", propertyTitle: "Sobha Galera" });
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 10, total: 1, pages: 1 });
  });

  it("returns lead dashboard metrics including qualified leads", async () => {
    const { token } = await createAdminToken();
    await Lead.create({ type: "contact", name: "New customer", status: "new" });
    await Lead.create({ type: "contact", name: "Reviewed customer", status: "contacted" });
    await Lead.create({ type: "property_interest", name: "Qualified customer", status: "qualified" });

    const res = await request(app).get("/api/leads/metrics").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 3, new: 1, contacted: 1, qualified: 1, needsAttention: 1 });
  });

  it("saves admin qualification and internal follow-up history", async () => {
    const { token } = await createAdminToken();
    const lead = await Lead.create({ type: "property_interest", name: "Asha", propertyTitle: "Lakeview Heights" });

    const qualification = await request(app)
      .patch(`/api/leads/${lead._id}/qualification`)
      .set("Authorization", `Bearer ${token}`)
      .send({ score: 72, level: "high", reasons: ["Viewed the same project repeatedly"] });
    expect(qualification.status).toBe(200);
    expect(qualification.body.lead).toMatchObject({ qualificationScore: 72, qualificationLevel: "high" });

    const note = await request(app)
      .patch(`/api/leads/${lead._id}/follow-up`)
      .set("Authorization", `Bearer ${token}`)
      .send({ note: "Interested in a weekend site visit.", assignedTo: "Sales desk" });
    expect(note.status).toBe(200);
    expect(note.body.lead.followUpHistory).toHaveLength(1);
    expect(note.body.lead).toMatchObject({ followUpNote: "Interested in a weekend site visit.", assignedTo: "Sales desk" });
  });

  it("imports compact spreadsheet rows and rejects duplicate identities", async () => {
    const { token } = await createAdminToken();
    await Lead.create({ type: "contact", name: "Existing", phone: "9876543210" });

    const res = await request(app)
      .post("/api/leads/import")
      .set("Authorization", `Bearer ${token}`)
      .send({ rows: [
        { name: "Duplicate", phone: "+91 98765 43210" },
        { name: "New buyer", phone: "9876501234", propertyTitle: "ClearTitle Heights", budget: "₹1 Cr" },
      ] });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ imported: 1, rejected: 1 });
    expect(await Lead.countDocuments({ source: "admin_import" })).toBe(1);
  });
});
