const request = require("supertest");
const app = require("../src/app");
const CRMStaffAccount = require("../src/models/CRMStaffAccount");
const CPCRMFollowUp = require("../src/models/CPCRMFollowUp");
const CPCRMInteraction = require("../src/models/CPCRMInteraction");
const CPCRMProfile = require("../src/models/CPCRMProfile");
const { createAdminToken } = require("./helpers");

const doc = (name = "document.pdf", mimeType = "application/pdf") => ({
  url: `https://cdn.example.com/${name}`, originalName: name, mimeType, bytes: 2048,
});

function application() {
  return {
    company: { name: "CRM Realty", businessType: "partnership", yearEstablished: 2020, panNumber: "ABCDE1234F", gstNumber: "", reraApplicable: false, reraNumber: "" },
    contact: { name: "Ravi Kumar", designation: "Partner", mobile: "9876543210", alternateMobile: "", email: "crm-partner@example.com" },
    address: { line1: "12 Residency Road", line2: "", city: "Bengaluru", state: "Karnataka", pinCode: "560001" },
    business: { areasOfOperation: ["Whitefield"], currentProjects: "Project One", developerAssociations: "Builder One", teamStrength: "3_5", preferredSegments: ["apartments"] },
    bank: { accountHolderName: "CRM Realty", bankName: "Example Bank", branch: "MG Road", accountNumber: "123456789012", ifscCode: "ABCD0123456" },
    documents: { panCard: doc("pan.pdf"), cancelledCheque: doc("cheque.png", "image/png"), signatureUpload: doc("signature.png", "image/png") },
    declaration: { informationAccurate: true, partnerPolicyAccepted: true, leadPolicyAccepted: true, brokeragePolicyAccepted: true, approvalAcknowledged: true },
    signatory: { name: "Ravi Kumar", designation: "Partner", signedDate: "2026-08-04" }, signature: { mode: "uploaded" },
  };
}

describe("CP Management CRM", () => {
  it("tracks an assigned employee call, callback, and manual WhatsApp result", async () => {
    const { token: adminToken } = await createAdminToken();
    const registration = await request(app).post("/api/channel-partners").send(application());
    expect(registration.status).toBe(201);

    const created = await request(app).post("/api/cp-crm/admin/employees").set("Authorization", `Bearer ${adminToken}`).send({
      employeeId: "EMP-001", name: "Nisha Rao", password: "StrongPass123", permissions: ["cp_crm.view", "cp_crm.contact"],
    });
    expect(created.status).toBe(201);
    expect(created.body.employee.employeeId).toBe("EMP-001");
    expect(created.body.employee.passwordHash).toBeUndefined();
    const storedStaff = await CRMStaffAccount.findOne({ employeeId: "EMP-001" }).select("+passwordHash");
    expect(storedStaff.passwordHash).not.toContain("StrongPass123");

    const login = await request(app).post("/api/cp-crm/auth/login").send({ employeeId: "emp-001", password: "StrongPass123" });
    expect(login.status).toBe(200);
    const staffToken = login.body.token;

    const task = await request(app).post("/api/cp-crm/admin/tasks").set("Authorization", `Bearer ${adminToken}`).send({
      employeeId: created.body.employee.id, count: 1, title: "Call one CP", instructions: "Record the response",
    });
    expect(task.status).toBe(201);
    expect(task.body.task.assignedCount).toBe(1);

    const assigned = await request(app).get("/api/cp-crm/mine/partners").set("Authorization", `Bearer ${staffToken}`);
    expect(assigned.status).toBe(200);
    expect(assigned.body.partners).toHaveLength(1);
    const partnerId = assigned.body.partners[0].partner.id;

    const callStart = await request(app).post(`/api/cp-crm/mine/partners/${partnerId}/call-start`).set("Authorization", `Bearer ${staffToken}`);
    expect(callStart.status).toBe(201);
    expect(callStart.body.dialNumber).toBe("9876543210");

    const callbackAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const callResult = await request(app).post(`/api/cp-crm/mine/partners/${partnerId}/call-result`).set("Authorization", `Bearer ${staffToken}`).send({
      outcome: "callback_requested", callbackAt, priority: "important", note: "Call after the customer meeting",
    });
    expect(callResult.status).toBe(201);
    expect(await CPCRMFollowUp.countDocuments({ status: "pending" })).toBe(1);

    const template = await request(app).post("/api/cp-crm/admin/templates").set("Authorization", `Bearer ${adminToken}`).send({
      name: "Project introduction", kind: "project", projectName: "ClearTitle Heights", body: "Hello Ravi, project details: https://example.com/project",
    });
    expect(template.status).toBe(201);

    const whatsapp = await request(app).post(`/api/cp-crm/mine/partners/${partnerId}/whatsapp-open`).set("Authorization", `Bearer ${staffToken}`).send({
      templateId: template.body.template.id, messageBody: "Hello Ravi, project details: https://example.com/project",
    });
    expect(whatsapp.status).toBe(201);
    expect(whatsapp.body.whatsappUrl).toContain("https://wa.me/919876543210?text=");

    const sent = await request(app).post(`/api/cp-crm/mine/partners/${partnerId}/whatsapp-result`).set("Authorization", `Bearer ${staffToken}`).send({ outcome: "sent", interactionId: whatsapp.body.interactionId });
    expect(sent.status).toBe(201);
    expect(await CPCRMInteraction.countDocuments({ action: "whatsapp_result", outcome: "sent" })).toBe(1);

    const employees = await request(app).get("/api/cp-crm/admin/employees").set("Authorization", `Bearer ${adminToken}`);
    expect(employees.status).toBe(200);
    expect(employees.body.employees[0].metrics).toMatchObject({ assigned: 1, contacted: 1, callResults: 1, callbacksScheduled: 1, whatsappSent: 1 });
    const activity = await request(app).get(`/api/cp-crm/admin/employees/${created.body.employee.id}/activity`).set("Authorization", `Bearer ${adminToken}`);
    expect(activity.status).toBe(200);
    expect(activity.body.interactions).toHaveLength(4);
    expect(activity.body.followUps[0]).toMatchObject({ status: "pending", partner: { companyName: "CRM Realty" } });
  }, 60000);

  it("requires a future date and time when callback is requested", async () => {
    const { token: adminToken } = await createAdminToken();
    await request(app).post("/api/channel-partners").send(application());
    const created = await request(app).post("/api/cp-crm/admin/employees").set("Authorization", `Bearer ${adminToken}`).send({ employeeId: "EMP-002", name: "Kiran Rao", password: "StrongPass123" });
    const login = await request(app).post("/api/cp-crm/auth/login").send({ employeeId: "EMP-002", password: "StrongPass123" });
    await request(app).post("/api/cp-crm/admin/tasks").set("Authorization", `Bearer ${adminToken}`).send({ employeeId: created.body.employee.id, count: 1 });
    const assigned = await request(app).get("/api/cp-crm/mine/partners").set("Authorization", `Bearer ${login.body.token}`);
    const partnerId = assigned.body.partners[0].partner.id;
    const result = await request(app).post(`/api/cp-crm/mine/partners/${partnerId}/call-result`).set("Authorization", `Bearer ${login.body.token}`).send({ outcome: "callback_requested" });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/future callback date and time/i);
  }, 60000);

  it("deletes an employee safely and returns assigned contacts to the pool", async () => {
    const { token: adminToken } = await createAdminToken();
    const registration = await request(app).post("/api/channel-partners").send(application());
    expect(registration.status).toBe(201);
    const created = await request(app).post("/api/cp-crm/admin/employees").set("Authorization", `Bearer ${adminToken}`).send({
      employeeId: "EMP-DELETE", name: "Delete Test", password: "StrongPass123",
    });
    const employeeId = created.body.employee.id;
    const login = await request(app).post("/api/cp-crm/auth/login").send({ employeeId: "EMP-DELETE", password: "StrongPass123" });
    await request(app).post("/api/cp-crm/admin/tasks").set("Authorization", `Bearer ${adminToken}`).send({ employeeId, count: 1 });
    expect(await CPCRMProfile.countDocuments({ assignedEmployeeId: employeeId })).toBe(1);

    const removed = await request(app).delete(`/api/cp-crm/admin/employees/${employeeId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(removed.status).toBe(200);
    expect(removed.body.unassigned.registered).toBe(1);
    expect(await CPCRMProfile.countDocuments({ assignedEmployeeId: employeeId })).toBe(0);

    const directory = await request(app).get("/api/cp-crm/admin/employees").set("Authorization", `Bearer ${adminToken}`);
    expect(directory.body.employees).toHaveLength(0);
    const oldSession = await request(app).get("/api/cp-crm/auth/me").set("Authorization", `Bearer ${login.body.token}`);
    expect(oldSession.status).toBe(403);
    const relogin = await request(app).post("/api/cp-crm/auth/login").send({ employeeId: "EMP-DELETE", password: "StrongPass123" });
    expect(relogin.status).toBe(401);
  }, 60000);
});
