const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const { createAdminToken, createUserToken } = require("./helpers");

describe("RERA document security and removed property fields", () => {
  it("keeps document storage URLs out of the public property response", async () => {
    const property = await Property.create({
      title: "Phase Project",
      price: "1",
      status: "approved",
      reraRegistered: true,
      reraNumber: "PRM/KA/RERA/1234",
      reraPhases: [{
        name: "Phase 1",
        reraNumber: "PRM/KA/RERA/1234",
        reraSiteUrl: "https://rera.karnataka.gov.in/project",
        reraDocuments: [{
          key: "registration-certificate",
          label: "Registration Certificate",
          annexure: "Annexure 1",
          fileName: "registration.pdf",
          fileUrl: "https://res.cloudinary.com/demo/raw/upload/registration.pdf",
          mimeType: "application/pdf",
          fileSize: 1024,
        }],
      }],
    });

    const response = await request(app).get(`/api/properties/${property._id}`);
    expect(response.status).toBe(200);
    expect(response.body.property.reraPhases[0].reraDocuments[0].fileUrl).toBeUndefined();
    expect(response.body.property.reraPhases[0].reraDocuments[0].fileName).toBe("registration.pdf");
  });

  it("requires OTP-authenticated customer access and a completed identity before download", async () => {
    const property = await Property.create({
      title: "Phase Project",
      price: "1",
      status: "approved",
      reraRegistered: true,
      reraNumber: "PRM/KA/RERA/1234",
      reraPhases: [{
        name: "Phase 1",
        reraNumber: "PRM/KA/RERA/1234",
        reraDocuments: [{
          key: "registration-certificate",
          label: "Registration Certificate",
          fileName: "registration.pdf",
          fileUrl: "https://res.cloudinary.com/demo/raw/upload/registration.pdf",
          mimeType: "application/pdf",
          fileSize: 1024,
        }],
      }],
    });
    const phase = property.reraPhases[0];
    const document = phase.reraDocuments[0];
    const path = `/api/properties/${property._id}/documents/${phase._id}/${document._id}/download`;

    expect((await request(app).get(path)).status).toBe(401);
    const { token } = await createUserToken();
    const incomplete = await request(app).get(path).set("Authorization", `Bearer ${token}`);
    expect(incomplete.status).toBe(400);
    expect(incomplete.body.error).toMatch(/name and email/i);
  });

  it("strips maintenance charges and dealer linkage from writes", async () => {
    const { token } = await createAdminToken();
    const response = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Clean property",
        price: "1",
        maintenanceCharges: "5000",
        maintenancePeriod: "month",
        dealerId: "507f1f77bcf86cd799439012",
        rentDetails: { maintenanceMode: "Extra", maintenanceAmount: 5000 },
        leaseDetails: { camCharges: "12/sqft" },
      });

    expect(response.status).toBe(201);
    const stored = await Property.findById(response.body.property.id).lean();
    expect(stored.maintenanceCharges).toBeUndefined();
    expect(stored.dealerId).toBeUndefined();
    expect(stored.rentDetails?.maintenanceMode).toBeUndefined();
    expect(stored.leaseDetails?.camCharges).toBeUndefined();
  });
});
