const request = require("supertest");
const app = require("../src/app");
const { createAdminToken } = require("./helpers");

const lawyerPayload = {
  name: "Adv. Ananya Sharma",
  qualification: "B.A. LL.B., LL.M.",
  college: "National Law School of India University",
  graduationYear: "2012",
  experience: "12+ years",
  barCouncil: "KA/1234/2012",
  rating: 4.9,
  cases: "220+",
  specialty: "Property Title Verification",
  languages: "English, Kannada, Hindi",
  city: "Bengaluru",
  bio: "Real-estate lawyer focused on title and deed reviews.",
  whatsappNumber: "+919876543210",
  legalDocumentType: "Bar Council Enrollment Certificate",
  legalDocumentNumber: "KA/1234/2012",
  legalDocumentUrl: "https://cdn.example.com/lawyer-certificate.pdf",
  image: "https://cdn.example.com/lawyer.jpg",
  status: "approved",
};

describe("Lawyer consultation profiles", () => {
  it("allows an admin to add the complete consultation profile", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/cms/lawyers")
      .set("Authorization", `Bearer ${token}`)
      .send(lawyerPayload);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: lawyerPayload.name,
      qualification: lawyerPayload.qualification,
      college: lawyerPayload.college,
      whatsappNumber: lawyerPayload.whatsappNumber,
      legalDocumentNumber: lawyerPayload.legalDocumentNumber,
    });
  });

  it("shows approved public profile details without exposing the phone or document number", async () => {
    const { token } = await createAdminToken();
    await request(app).post("/api/cms/lawyers").set("Authorization", `Bearer ${token}`).send(lawyerPayload);

    const res = await request(app).get("/api/cms/lawyers");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      name: lawyerPayload.name,
      qualification: lawyerPayload.qualification,
      documentVerified: true,
      whatsappAvailable: true,
    });
    expect(res.body[0].whatsappNumber).toBeUndefined();
    expect(res.body[0].legalDocumentNumber).toBeUndefined();
    expect(res.body[0].legalDocumentUrl).toBeUndefined();
  });

  it("protects the full lawyer directory behind admin authentication", async () => {
    expect((await request(app).get("/api/cms/lawyers/admin")).status).toBe(401);
  });
});
