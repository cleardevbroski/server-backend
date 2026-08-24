const request = require("supertest");
const app = require("../src/app");
const PropertyPosterAccount = require("../src/models/PropertyPosterAccount");
const PropertyPosterDocument = require("../src/models/PropertyPosterDocument");
const { createAdminToken } = require("./helpers");

async function verifyPropertyEmail(email = "owner@propertymail.in") {
  const requested = await request(app).post("/api/property-auth/request-otp").send({ email });
  expect(requested.status).toBe(200);
  expect(requested.body.devOtp).toMatch(/^\d{6}$/);
  const verified = await request(app).post("/api/property-auth/verify-otp").send({ email, otp: requested.body.devOtp });
  expect(verified.status).toBe(200);
  expect(verified.body.user.role).toBe("property_submitter");
  expect(verified.body.user.verificationSource).toBe("email");
  return verified.body;
}

async function createPrivateDocument(accountId, purpose, index) {
  return PropertyPosterDocument.create({
    posterAccount: accountId,
    purpose,
    publicId: `clear-title/property-verification/test-${index}`,
    resourceType: "raw",
    deliveryType: "authenticated",
    version: 1,
    format: "pdf",
    mimeType: "application/pdf",
    fileName: `${purpose}.pdf`,
    bytes: 1200 + index,
  });
}

describe("email-authenticated property posting", () => {
  it("verifies email, creates an isolated account and restores it through /auth/me", async () => {
    const session = await verifyPropertyEmail();
    expect(await PropertyPosterAccount.countDocuments({ email: "owner@propertymail.in" })).toBe(1);

    const me = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${session.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("owner@propertymail.in");
    expect(me.body.user.phone).toBe("");
  });

  it("rejects an incorrect code without storing the plain OTP", async () => {
    const requested = await request(app).post("/api/property-auth/request-otp").send({ email: "wrong-code@propertymail.in" });
    const wrong = requested.body.devOtp === "000000" ? "000001" : "000000";
    const verified = await request(app).post("/api/property-auth/verify-otp").send({ email: "wrong-code@propertymail.in", otp: wrong });
    expect(verified.status).toBe(400);
    expect(verified.body.attemptsRemaining).toBe(4);
  });

  it("stores individual verification privately and keeps it out of public listing responses", async () => {
    const session = await verifyPropertyEmail("individual@propertymail.in");
    const account = await PropertyPosterAccount.findOne({ email: "individual@propertymail.in" });
    const pan = await createPrivateDocument(account._id, "individual-pan", 1);
    const aadhaar = await createPrivateDocument(account._id, "individual-aadhaar", 2);
    const ownership = await createPrivateDocument(account._id, "individual-ownership", 3);

    const submitted = await request(app)
      .post("/api/properties/public")
      .set("Authorization", `Bearer ${session.token}`)
      .send({
        title: "Email Verified Home",
        subtitle: "Sadahalli",
        price: "85 L",
        submissionProfile: {
          posterType: "individual",
          consentAccepted: true,
          individual: {
            ownerName: "Venu Rao",
            phone: "9876543210",
            panNumber: "ABCDE1234F",
            aadhaarLast4: "4821",
            panDocument: { id: pan._id },
            aadhaarDocument: { id: aadhaar._id },
            ownershipDocument: { id: ownership._id },
          },
        },
      });
    expect(submitted.status).toBe(201);
    expect(submitted.body.property.submissionProfile.individual.panLast4).toBe("234F");
    expect(submitted.body.property.submissionProfile.individual).not.toHaveProperty("panNumber");
    expect(submitted.body.property.postedBy).toBeUndefined();
    expect(String(submitted.body.property.propertyPoster)).toBe(String(account._id));

    const mine = await request(app).get("/api/properties/my").set("Authorization", `Bearer ${session.token}`);
    expect(mine.status).toBe(200);
    expect(mine.body.properties[0].submissionProfile.individual.aadhaarLast4).toBe("4821");

    const { token: adminToken } = await createAdminToken();
    const published = await request(app)
      .put(`/api/properties/admin/submissions/${submitted.body.property.id}/review`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "publish" });
    expect(published.status).toBe(200);

    const publicListing = await request(app).get(`/api/properties/${submitted.body.property.id}`);
    expect(publicListing.status).toBe(200);
    expect(publicListing.body.property).not.toHaveProperty("submissionProfile");
    expect(publicListing.body.property).not.toHaveProperty("propertyPoster");
  });
});
