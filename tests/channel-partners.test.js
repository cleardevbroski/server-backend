const request = require("supertest");
const app = require("../src/app");
const ChannelPartner = require("../src/models/ChannelPartner");
const ChannelPartnerClient = require("../src/models/ChannelPartnerClient");
const ChannelPartnerClientClash = require("../src/models/ChannelPartnerClientClash");
const Property = require("../src/models/Property");
const { createAdminToken, createUserToken } = require("./helpers");

const doc = (name = "document.pdf", mimeType = "application/pdf") => ({
  url: `https://cdn.example.com/${name}`,
  originalName: name,
  mimeType,
  bytes: 2048,
});

function validApplication(overrides = {}) {
  return {
    company: { name: "Northstar Realty", businessType: "partnership", yearEstablished: 2018, panNumber: "ABCDE1234F", gstNumber: "", reraApplicable: false, reraNumber: "" },
    contact: { name: "Asha Rao", designation: "Partner", mobile: "9876543210", alternateMobile: "", email: "asha@example.com" },
    address: { line1: "12 Residency Road", line2: "", city: "Bengaluru", state: "Karnataka", pinCode: "560001" },
    business: { areasOfOperation: ["Whitefield", "North Bengaluru"], currentProjects: "Project One", developerAssociations: "Builder One", teamStrength: "3_5", preferredSegments: ["apartments", "villas"] },
    bank: { accountHolderName: "Northstar Realty", bankName: "Example Bank", branch: "MG Road", accountNumber: "123456789012", ifscCode: "ABCD0123456" },
    documents: { panCard: doc("pan.pdf"), cancelledCheque: doc("cheque.png", "image/png"), signatureUpload: doc("signature.png", "image/png") },
    declaration: { informationAccurate: true, partnerPolicyAccepted: true, leadPolicyAccepted: true, brokeragePolicyAccepted: true, approvalAcknowledged: true },
    signatory: { name: "Asha Rao", designation: "Partner", signedDate: "2026-08-04" },
    signature: { mode: "uploaded" },
    ...overrides,
  };
}

describe("Channel partners API", () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    jest.restoreAllMocks();
  });

  it("creates an application, encrypts the account number, and returns a reference", async () => {
    const res = await request(app).post("/api/channel-partners").set("Idempotency-Key", "application-1").send(validApplication());
    expect(res.status).toBe(201);
    expect(res.body.application.applicationNumber).toMatch(/^CP-\d{4}-\d{6}$/);
    expect(res.body.application.partnerCode).toMatch(/^CT-\d{4,}$/);
    expect(res.body.application.status).toBe("active");
    expect(res.body.application.partnerType).toBe("company");
    const stored = await ChannelPartner.findOne().select("+bank.accountNumberEncrypted");
    expect(stored.bank.accountNumberEncrypted).not.toContain("123456789012");
    expect(stored.bank.accountNumberLast4).toBe("9012");
  });

  it("uses the stable JWT secret when a production deployment has no dedicated channel-partner key", async () => {
    const encryptionKey = process.env.CHANNEL_PARTNER_ENCRYPTION_KEY;
    const lookupKey = process.env.CHANNEL_PARTNER_LOOKUP_KEY;
    delete process.env.CHANNEL_PARTNER_ENCRYPTION_KEY;
    delete process.env.CHANNEL_PARTNER_LOOKUP_KEY;

    try {
      const res = await request(app).post("/api/channel-partners").send(validApplication());
      expect(res.status).toBe(201);
      expect(res.body.message).toBe("Channel partner registered successfully");
      const stored = await ChannelPartner.findOne().select("+bank.accountNumberEncrypted");
      expect(stored.bank.accountNumberEncrypted).not.toContain("123456789012");
    } finally {
      process.env.CHANNEL_PARTNER_ENCRYPTION_KEY = encryptionKey;
      if (lookupKey === undefined) delete process.env.CHANNEL_PARTNER_LOOKUP_KEY;
      else process.env.CHANNEL_PARTNER_LOOKUP_KEY = lookupKey;
    }
  });

  it("makes repeat requests idempotent", async () => {
    const first = await request(app).post("/api/channel-partners").set("Idempotency-Key", "repeat-key").send(validApplication());
    const second = await request(app).post("/api/channel-partners").set("Idempotency-Key", "repeat-key").send(validApplication());
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.application.applicationNumber).toBe(first.body.application.applicationNumber);
    expect(second.body.application.partnerCode).toBe(first.body.application.partnerCode);
    expect(await ChannelPartner.countDocuments()).toBe(1);
  });

  it("requires a RERA certificate when RERA applies", async () => {
    const input = validApplication();
    input.company.reraNumber = "PRM/KA/RERA/1234";
    const res = await request(app).post("/api/channel-partners").send(input);
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain("RERA certificate is required");
  });

  it("allows an omitted establishment year and requires current projects", async () => {
    const input = validApplication();
    input.company.yearEstablished = "";
    const ok = await request(app).post("/api/channel-partners").send(input);
    expect(ok.status).toBe(201);

    await ChannelPartner.deleteMany({});
    const missingProjects = validApplication({ business: { ...input.business, currentProjects: "" } });
    const invalid = await request(app).post("/api/channel-partners").send(missingProjects);
    expect(invalid.status).toBe(400);
    expect(invalid.body.errors).toContain("Projects currently selling is required");
  });

  it("continues to require team strength for company applications", async () => {
    const input = validApplication();
    delete input.business.teamStrength;
    const res = await request(app).post("/api/channel-partners").send(input);
    expect(res.status).toBe(400);
    expect(res.body.errors).toContain("Choose a valid team strength");
  });

  it("accepts individual partners without team strength and strips company-only values", async () => {
    const input = validApplication();
    input.partnerType = "individual";
    input.company.name = "Asha Rao";
    delete input.business.teamStrength;
    input.documents.companyLogo = doc("company-logo.png", "image/png");
    const res = await request(app).post("/api/channel-partners").send(input);
    expect(res.status).toBe(201);
    expect(res.body.application.partnerType).toBe("individual");

    const stored = await ChannelPartner.findOne();
    expect(stored.partnerType).toBe("individual");
    expect(stored.business.teamStrength).toBeUndefined();
    expect(stored.documents.companyLogo).toBeNull();
  });

  it("uses individual-name validation and rejects unsupported partner types", async () => {
    const individual = validApplication();
    individual.partnerType = "individual";
    individual.company.name = "";
    delete individual.business.teamStrength;
    const missingName = await request(app).post("/api/channel-partners").send(individual);
    expect(missingName.status).toBe(400);
    expect(missingName.body.errors).toContain("Partner name is required");

    const invalid = validApplication();
    invalid.partnerType = "agency";
    const unsupported = await request(app).post("/api/channel-partners").send(invalid);
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.errors).toContain("Choose a valid channel partner type");
  });

  it("rejects invalid identifiers and declarations", async () => {
    const input = validApplication();
    input.company.panNumber = "INVALID";
    input.bank.ifscCode = "BAD";
    input.declaration.partnerPolicyAccepted = false;
    const res = await request(app).post("/api/channel-partners").send(input);
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.arrayContaining(["Enter a valid PAN number", "Enter a valid IFSC code", "All declarations and policies must be accepted"]));
  });

  it("protects admin listing and returns masked records", async () => {
    await request(app).post("/api/channel-partners").send(validApplication());
    expect((await request(app).get("/api/channel-partners")).status).toBe(401);
    const { token } = await createUserToken();
    expect((await request(app).get("/api/channel-partners").set("Authorization", `Bearer ${token}`)).status).toBe(403);
    const admin = await createAdminToken();
    const res = await request(app).get("/api/channel-partners").set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.partners[0].panMasked).toMatch(/234F$/);
    expect(JSON.stringify(res.body)).not.toContain("123456789012");
  });

  it("lets only an admin delete a partner, clears related records, and permits registration again", async () => {
    const created = await request(app)
      .post("/api/channel-partners")
      .set("Idempotency-Key", "delete-and-register-again")
      .send(validApplication());
    const partner = await ChannelPartner.findOne();
    const project = await Property.create({ title: "ClearTitle Delete Test", published: true, status: "approved" });
    const client = await ChannelPartnerClient.create({
      leadNumber: "CTL-2026-999991",
      partnerId: partner._id,
      partnerCodeLast4: created.body.application.partnerCode.slice(-4),
      clientName: "Delete Test Client",
      mobileEncrypted: "encrypted-mobile",
      mobileHash: "delete-test-mobile-hash",
      mobileLast4: "1111",
      projectId: project._id,
      projectTitle: project.title,
      consentAcceptedAt: new Date(),
      ownershipExpiresAt: new Date(Date.now() + 86_400_000),
    });
    await ChannelPartnerClientClash.create({
      attemptingPartnerId: partner._id,
      owningPartnerId: partner._id,
      owningClientId: client._id,
      mobileHash: "delete-test-mobile-hash",
      mobileLast4: "1111",
      clientName: client.clientName,
      projectId: project._id,
      projectTitle: project.title,
    });

    expect((await request(app).delete(`/api/channel-partners/${partner._id}`)).status).toBe(401);
    const user = await createUserToken();
    expect((await request(app).delete(`/api/channel-partners/${partner._id}`).set("Authorization", `Bearer ${user.token}`)).status).toBe(403);

    const admin = await createAdminToken();
    const deleted = await request(app).delete(`/api/channel-partners/${partner._id}`).set("Authorization", `Bearer ${admin.token}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toEqual({ partners: 1, clients: 1, clashes: 1 });
    expect(await ChannelPartner.countDocuments()).toBe(0);
    expect(await ChannelPartnerClient.countDocuments()).toBe(0);
    expect(await ChannelPartnerClientClash.countDocuments()).toBe(0);

    const registeredAgain = await request(app)
      .post("/api/channel-partners")
      .set("Idempotency-Key", "delete-and-register-again")
      .send(validApplication());
    expect(registeredAgain.status).toBe(201);
    expect(registeredAgain.body.application.applicationNumber).not.toBe(created.body.application.applicationNumber);
  });

  it("activates immediately and allows an admin to suspend, restore, and read decrypted details", async () => {
    await request(app).post("/api/channel-partners").send(validApplication());
    const partner = await ChannelPartner.findOne();
    const { token } = await createAdminToken();
    expect(partner.status).toBe("active");
    const suspend = await request(app).patch(`/api/channel-partners/${partner._id}/status`).set("Authorization", `Bearer ${token}`).send({ status: "suspended", note: "Policy check" });
    expect(suspend.status).toBe(200);
    const restore = await request(app).patch(`/api/channel-partners/${partner._id}/status`).set("Authorization", `Bearer ${token}`).send({ status: "active" });
    expect(restore.status).toBe(200);
    const detail = await request(app).get(`/api/channel-partners/${partner._id}`).set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.partner.bank.accountNumber).toBe("123456789012");
    expect(detail.body.partner.partnerCode).toMatch(/^CT-\d{4,}$/);
    expect(detail.body.partner.reviewHistory).toHaveLength(3);
  });

  it("starts a dashboard session after registration and replaces a forgotten code after email OTP verification", async () => {
    const created = await request(app).post("/api/channel-partners").send(validApplication());
    expect(created.status).toBe(201);
    expect(created.body.token).toEqual(expect.any(String));
    const oldCode = created.body.application.partnerCode;
    const oldToken = created.body.token;

    const initialDashboard = await request(app)
      .get("/api/channel-partner-leads/mine/dashboard")
      .set("Authorization", `Bearer ${oldToken}`);
    expect(initialDashboard.status).toBe(200);

    process.env.RESEND_API_KEY = "test-resend-key";
    const emailRequest = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "email-id" }) });
    const requested = await request(app).post("/api/channel-partner-auth/forgot-code").send({ email: "ASHA@EXAMPLE.COM" });
    expect(requested.status).toBe(200);
    expect(requested.body.message).toContain("OTP sent");
    const otpEmail = JSON.parse(emailRequest.mock.calls[0][1].body);
    const otp = otpEmail.html.match(/letter-spacing:5px[^>]*>(\d{6})<\/div>/)?.[1];
    expect(otp).toMatch(/^\d{6}$/);

    const incorrect = await request(app).post("/api/channel-partner-auth/verify-otp").send({ email: "asha@example.com", otp: "000000" });
    expect(incorrect.status).toBe(400);
    expect(incorrect.body.attemptsRemaining).toBe(4);

    const verified = await request(app).post("/api/channel-partner-auth/verify-otp").send({ email: "asha@example.com", otp });
    expect(verified.status).toBe(200);
    expect(verified.body.message).toContain("new Channel Partner code");
    expect(emailRequest).toHaveBeenCalledTimes(2);
    const replacementEmail = JSON.parse(emailRequest.mock.calls[1][1].body);
    const newCode = replacementEmail.html.match(/CT-\d{4,}/)?.[0];
    expect(newCode).toMatch(/^CT-\d{4,}$/);
    expect(newCode).not.toBe(oldCode);

    expect((await request(app).post("/api/channel-partner-leads/session").send({ partnerCode: oldCode })).status).toBe(401);
    expect((await request(app).get("/api/channel-partner-leads/mine/dashboard").set("Authorization", `Bearer ${oldToken}`)).status).toBe(401);
    const newSession = await request(app).post("/api/channel-partner-leads/session").send({ partnerCode: newCode });
    expect(newSession.status).toBe(200);

    const unknown = await request(app).post("/api/channel-partner-auth/forgot-code").send({ email: "not-registered@example.com" });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ error: "This email is not registered as a Channel Partner.", registrationUrl: "/channel-partner" });
  });

  it("keeps the admin detail usable when legacy encrypted values cannot be decrypted", async () => {
    await request(app).post("/api/channel-partners").send(validApplication());
    const partner = await ChannelPartner.findOne();
    await ChannelPartner.collection.updateOne(
      { _id: partner._id },
      { $set: { "bank.accountNumberEncrypted": "invalid-value", partnerCodeEncrypted: "invalid-value" } },
    );
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    const { token } = await createAdminToken();
    const detail = await request(app).get(`/api/channel-partners/${partner._id}`).set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.partner.sensitiveDataAvailable).toBe(false);
    expect(detail.body.partner.decryptionWarnings).toEqual(expect.arrayContaining(["bankAccount", "partnerCode"]));
    expect(detail.body.partner.bank.accountNumber).toBe("");
    expect(log).toHaveBeenCalled();
  });

  it("emails registration and status responses and lets an admin resend the welcome email", async () => {
    process.env.RESEND_API_KEY = "test-resend-key";
    const emailRequest = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "email-id" }) });
    const created = await request(app).post("/api/channel-partners").send(validApplication());
    expect(created.status).toBe(201);
    expect(created.body.emailSent).toBe(true);

    const partner = await ChannelPartner.findOne();
    const { token } = await createAdminToken();
    const suspended = await request(app)
      .patch(`/api/channel-partners/${partner._id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "suspended", note: "Compliance documents expired" });
    expect(suspended.status).toBe(200);
    expect(suspended.body.emailSent).toBe(true);

    const resent = await request(app)
      .post(`/api/channel-partners/${partner._id}/resend-registration-email`)
      .set("Authorization", `Bearer ${token}`);
    expect(resent.status).toBe(200);
    expect(emailRequest).toHaveBeenCalledTimes(3);
    const sentEmails = emailRequest.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(sentEmails[0].subject).toContain("Registration Successful");
    expect(sentEmails[1].subject).toContain("Application Suspended");
    expect(sentEmails[1].html).toContain("Compliance documents expired");
    expect(sentEmails[2].subject).toContain("Registration Successful");
  });

  it("requires reasons and rejects invalid status transitions", async () => {
    await request(app).post("/api/channel-partners").send(validApplication());
    const partner = await ChannelPartner.findOne();
    const { token } = await createAdminToken();
    const invalid = await request(app).patch(`/api/channel-partners/${partner._id}/status`).set("Authorization", `Bearer ${token}`).send({ status: "approved" });
    expect(invalid.status).toBe(409);
    const missingReason = await request(app).patch(`/api/channel-partners/${partner._id}/status`).set("Authorization", `Bearer ${token}`).send({ status: "suspended" });
    expect(missingReason.status).toBe(400);
  });

  it("registers clients by partner code and blocks duplicates during the active 90 days", async () => {
    const firstPartner = await request(app).post("/api/channel-partners").send(validApplication());
    const secondInput = validApplication();
    secondInput.company.panNumber = "FGHIJ5678K";
    secondInput.company.name = "Second Realty";
    secondInput.contact.email = "second@example.com";
    secondInput.contact.mobile = "9876543211";
    const secondPartner = await request(app).post("/api/channel-partners").send(secondInput);
    const project = await Property.create({ title: "ClearTitle Heights", published: true, status: "approved" });

    const firstSession = await request(app).post("/api/channel-partner-leads/session").send({ partnerCode: firstPartner.body.application.partnerCode });
    const secondSession = await request(app).post("/api/channel-partner-leads/session").send({ partnerCode: secondPartner.body.application.partnerCode });
    expect(firstSession.status).toBe(200);
    expect(secondSession.status).toBe(200);

    const payload = { clientName: "Vikas Rao", mobile: "+91 99864 65931", email: "vikas@example.com", projectId: project._id.toString(), consentAccepted: true };
    process.env.RESEND_API_KEY = "test-resend-key";
    const emailRequest = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, json: async () => ({ id: "email-id" }) });
    const accepted = await request(app).post("/api/channel-partner-leads").set("Authorization", `Bearer ${firstSession.body.token}`).set("Idempotency-Key", "lead-one").send(payload);
    expect(accepted.status).toBe(201);
    expect(accepted.body.client.leadNumber).toMatch(/^CTL-\d{4}-\d{6}$/);

    const samePartnerDuplicate = await request(app).post("/api/channel-partner-leads").set("Authorization", `Bearer ${firstSession.body.token}`).send(payload);
    expect(samePartnerDuplicate.status).toBe(200);
    expect(samePartnerDuplicate.body.existing).toBe(true);

    const duplicate = await request(app).post("/api/channel-partner-leads").set("Authorization", `Bearer ${secondSession.body.token}`).send(payload);
    expect(duplicate.status).toBe(409);
    expect(JSON.stringify(duplicate.body)).not.toContain("Northstar");
    expect(await ChannelPartnerClient.countDocuments({ status: "pending" })).toBe(1);
    expect(await ChannelPartnerClientClash.countDocuments()).toBe(1);

    const client = await ChannelPartnerClient.findOne({ status: "pending" });
    const admin = await createAdminToken();
    const adminList = await request(app).get("/api/channel-partner-leads/admin/clients").set("Authorization", `Bearer ${admin.token}`);
    expect(adminList.status).toBe(200);
    expect(adminList.body.clients[0].channelPartner.name).toBe("Northstar Realty");

    const approved = await request(app)
      .patch(`/api/channel-partner-leads/admin/clients/${client._id}/status`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ status: "approved", bookingAdvanceAmountPaise: 20_000_000, note: "Booking confirmed" });
    expect(approved.status).toBe(200);
    expect(approved.body.client.initialCpAmountPaise).toBe(4_000_000);
    expect(new Date(approved.body.client.initialCreditAt).getTime() - new Date(approved.body.client.approvedAt).getTime()).toBe(12 * 60 * 60 * 1000);

    const dashboard = await request(app).get("/api/channel-partner-leads/mine/dashboard").set("Authorization", `Bearer ${firstSession.body.token}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.counts).toMatchObject({ total: 1, approved: 1, clashes: 1 });
    expect(dashboard.body.earnings.awaitingInitialPaise).toBe(4_000_000);

    const successful = await request(app)
      .patch(`/api/channel-partner-leads/admin/clients/${client._id}/status`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ status: "successful", finalSettlementCpAmountPaise: 1_500_000, note: "Full settlement received" });
    expect(successful.status).toBe(200);
    expect(successful.body.client.status).toBe("successful");
    expect(successful.body.client.finalSettlementCpAmountPaise).toBe(1_500_000);

    await ChannelPartnerClient.updateOne(
      { _id: client._id },
      { $set: { ownershipExpiresAt: new Date(Date.now() - 1000), initialCreditAt: new Date(Date.now() - 1000) } },
    );
    const creditedDashboard = await request(app).get("/api/channel-partner-leads/mine/dashboard").set("Authorization", `Bearer ${firstSession.body.token}`);
    expect(creditedDashboard.body.counts).toMatchObject({ successful: 1, expired: 0 });
    expect(creditedDashboard.body.earnings).toMatchObject({ creditedInitialPaise: 4_000_000, finalSettlementCreditedPaise: 1_500_000, totalCreditedPaise: 5_500_000 });
    expect(await ChannelPartnerClient.countDocuments({ status: "successful", claimActive: true })).toBe(1);

    const adminDashboard = await request(app).get(`/api/channel-partner-leads/admin/partners/${client.partnerId}/dashboard`).set("Authorization", `Bearer ${admin.token}`);
    expect(adminDashboard.status).toBe(200);
    expect(adminDashboard.body.counts.clashes).toBe(1);
    expect(adminDashboard.body.recentClashes).toHaveLength(1);

    const resent = await request(app)
      .post(`/api/channel-partner-leads/admin/clients/${client._id}/resend-email`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(resent.status).toBe(200);
    expect(resent.body.message).toContain("asha@example.com");

    expect(emailRequest).toHaveBeenCalledTimes(5);
    const sentEmails = emailRequest.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(sentEmails.map((email) => email.subject)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Client Registration Confirmed - CTL-/),
      "Alert: Client Already Registered",
      "Alert: Another Channel Partner Attempted to Register Your Client",
    ]));
    const clientConfirmationEmail = sentEmails.find((email) => email.subject.startsWith("Client Registration Confirmed - CTL-"));
    expect(clientConfirmationEmail.html).toContain("Open CP Dashboard");
    expect(clientConfirmationEmail.html).toContain("/cp-dashboard");
    expect(sentEmails.filter((email) => email.to[0] === "asha@example.com")).toHaveLength(4);
    expect(sentEmails.filter((email) => email.to[0] === "second@example.com")).toHaveLength(1);
    const samePartnerEmail = sentEmails.find((email) => email.subject === "Alert: Client Already Registered" && email.to[0] === "asha@example.com");
    expect(samePartnerEmail.html).toContain("already active under your account");
    const attemptingPartnerEmail = sentEmails.find((email) => email.to[0] === "second@example.com");
    expect(attemptingPartnerEmail.html).toContain("No new lead or ownership was created");
    expect(attemptingPartnerEmail.html).not.toContain("Northstar Realty");
  });

  it("removes expired clients from the old partner and lets another partner register them", async () => {
    const firstPartner = await request(app).post("/api/channel-partners").send(validApplication());
    const secondInput = validApplication();
    secondInput.company.panNumber = "LMNOP9012Q";
    secondInput.company.name = "Fresh Realty";
    secondInput.contact.email = "fresh@example.com";
    secondInput.contact.mobile = "9876543212";
    const secondPartner = await request(app).post("/api/channel-partners").send(secondInput);
    const project = await Property.create({ title: "ClearTitle Gardens", published: true, status: "approved" });
    const firstSession = await request(app).post("/api/channel-partner-leads/session").send({ partnerCode: firstPartner.body.application.partnerCode });
    const secondSession = await request(app).post("/api/channel-partner-leads/session").send({ partnerCode: secondPartner.body.application.partnerCode });
    const payload = { clientName: "Meera Shah", mobile: "9986465932", projectId: project._id.toString(), consentAccepted: true };
    await request(app).post("/api/channel-partner-leads").set("Authorization", `Bearer ${firstSession.body.token}`).send(payload);
    await ChannelPartnerClient.updateOne({}, { $set: { ownershipExpiresAt: new Date(Date.now() - 1000) } });

    const oldList = await request(app).get("/api/channel-partner-leads/mine").set("Authorization", `Bearer ${firstSession.body.token}`);
    expect(oldList.body.clients).toHaveLength(0);
    const reclaimed = await request(app).post("/api/channel-partner-leads").set("Authorization", `Bearer ${secondSession.body.token}`).send(payload);
    expect(reclaimed.status).toBe(201);
    expect(await ChannelPartnerClient.countDocuments({ status: "expired" })).toBe(1);
    expect(await ChannelPartnerClient.countDocuments({ status: "pending" })).toBe(1);
  });

  it("requires controlled transitions and releases ownership when a pending client is rejected", async () => {
    const firstPartner = await request(app).post("/api/channel-partners").send(validApplication());
    const secondInput = validApplication();
    secondInput.company.panNumber = "QRSTU3456V";
    secondInput.company.name = "Harbor Realty";
    secondInput.contact.email = "harbor@example.com";
    secondInput.contact.mobile = "9876543213";
    const secondPartner = await request(app).post("/api/channel-partners").send(secondInput);
    const project = await Property.create({ title: "ClearTitle Grove", published: true, status: "approved" });
    const firstSession = await request(app).post("/api/channel-partner-leads/session").send({ partnerCode: firstPartner.body.application.partnerCode });
    const secondSession = await request(app).post("/api/channel-partner-leads/session").send({ partnerCode: secondPartner.body.application.partnerCode });
    const payload = { clientName: "Nandita Iyer", mobile: "9986465934", projectId: project._id.toString(), consentAccepted: true };
    await request(app).post("/api/channel-partner-leads").set("Authorization", `Bearer ${firstSession.body.token}`).send(payload);
    const client = await ChannelPartnerClient.findOne({ status: "pending" });
    const admin = await createAdminToken();

    const missingAmount = await request(app).patch(`/api/channel-partner-leads/admin/clients/${client._id}/status`).set("Authorization", `Bearer ${admin.token}`).send({ status: "approved" });
    expect(missingAmount.status).toBe(400);
    const missingReason = await request(app).patch(`/api/channel-partner-leads/admin/clients/${client._id}/status`).set("Authorization", `Bearer ${admin.token}`).send({ status: "rejected" });
    expect(missingReason.status).toBe(400);
    const rejected = await request(app).patch(`/api/channel-partner-leads/admin/clients/${client._id}/status`).set("Authorization", `Bearer ${admin.token}`).send({ status: "rejected", reason: "Not eligible" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.client.claimActive).toBe(false);

    const reclaimed = await request(app).post("/api/channel-partner-leads").set("Authorization", `Bearer ${secondSession.body.token}`).send(payload);
    expect(reclaimed.status).toBe(201);
    expect(await ChannelPartnerClient.countDocuments({ claimActive: true })).toBe(1);
  });
});
