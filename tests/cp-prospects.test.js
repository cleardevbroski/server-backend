const request = require("supertest");
const app = require("../src/app");
const CPProspect = require("../src/models/CPProspect");
const CPProspectFollowUp = require("../src/models/CPProspectFollowUp");
const { createAdminToken } = require("./helpers");

async function createEmployee(adminToken, employeeId = "VERIFY-001") {
  const created = await request(app).post("/api/cp-crm/admin/employees").set("Authorization", `Bearer ${adminToken}`).send({
    employeeId, name: "Verification Employee", password: "StrongPass123", permissions: ["cp_crm.view", "cp_crm.contact"],
  });
  expect(created.status).toBe(201);
  const login = await request(app).post("/api/cp-crm/auth/login").send({ employeeId, password: "StrongPass123" });
  expect(login.status).toBe(200);
  return { employee: created.body.employee, token: login.body.token };
}

describe("Imported CP verification", () => {
  it("imports, groups by location, allocates, masks sensitive data, and records verification", async () => {
    const { token: adminToken } = await createAdminToken();
    const { employee, token: staffToken } = await createEmployee(adminToken);
    const batchResponse = await request(app).post("/api/cp-prospects/admin/imports").set("Authorization", `Bearer ${adminToken}`).send({
      name: "Bengaluru CP List", originalFileName: "cp-list.xlsx", totalRows: 4, mapping: { mobile: "Phone", city: "City" },
    });
    expect(batchResponse.status).toBe(201);
    const batchId = batchResponse.body.batch.id;

    const imported = await request(app).post(`/api/cp-prospects/admin/imports/${batchId}/rows`).set("Authorization", `Bearer ${adminToken}`).send({
      startRow: 2,
      rows: [
        { companyName: "East Realty", contactName: "Ravi", mobile: "9876543210", city: "Bengaluru", state: "Karnataka", areasOfOperation: "Whitefield; KR Puram", preferredSegments: "Apartment; Villa", panNumber: "ABCDE1234F", accountNumber: "123456789012" },
        { companyName: "South Realty", contactName: "Meera", mobile: "+91 98765 43211", city: "Bengaluru", state: "Karnataka", areasOfOperation: "Sarjapur", preferredSegments: "Plots" },
        { companyName: "Duplicate", mobile: "9876543210", city: "Bengaluru" },
        { companyName: "Invalid", mobile: "123", city: "Mysuru" },
      ],
    });
    expect(imported.status).toBe(200);
    expect(imported.body).toMatchObject({ imported: 2, duplicates: 1, invalid: 1 });
    const completed = await request(app).post(`/api/cp-prospects/admin/imports/${batchId}/complete`).set("Authorization", `Bearer ${adminToken}`);
    expect(completed.status).toBe(200);

    const analytics = await request(app).get("/api/cp-prospects/admin/analytics").set("Authorization", `Bearer ${adminToken}`);
    expect(analytics.status).toBe(200);
    expect(analytics.body.metrics).toMatchObject({ total: 2, unassigned: 2, pending: 2 });
    expect(analytics.body.locations).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "Karnataka", city: "Bengaluru", area: "Whitefield", total: 1 }),
      expect.objectContaining({ state: "Karnataka", city: "Bengaluru", area: "Sarjapur", total: 1 }),
    ]));

    const allocation = await request(app).patch("/api/cp-prospects/admin/prospects/allocate").set("Authorization", `Bearer ${adminToken}`).send({
      employeeId: employee.id, count: 10, filters: { city: "Bengaluru", area: "Whitefield" },
    });
    expect(allocation.status).toBe(200);
    expect(allocation.body.assignedCount).toBe(1);

    const queue = await request(app).get("/api/cp-prospects/mine/prospects").set("Authorization", `Bearer ${staffToken}`);
    expect(queue.status).toBe(200);
    expect(queue.body.prospects).toHaveLength(1);
    const prospect = queue.body.prospects[0];
    expect(prospect.address.city).toBe("Bengaluru");
    expect(prospect.company.panMasked).toBe("******234F");
    expect(prospect.bank.accountNumberMasked).toBe("XXXXXXXX9012");
    expect(JSON.stringify(prospect)).not.toContain("ABCDE1234F");
    expect(JSON.stringify(prospect)).not.toContain("123456789012");

    const call = await request(app).post(`/api/cp-prospects/mine/prospects/${prospect.id}/call-start`).set("Authorization", `Bearer ${staffToken}`);
    expect(call.status).toBe(201);
    expect(call.body.dialNumber).toBe("9876543210");

    const update = await request(app).patch(`/api/cp-prospects/mine/prospects/${prospect.id}/profile`).set("Authorization", `Bearer ${staffToken}`).send({
      partnerType: "company",
      company: { businessType: "partnership", panNumber: "AAAAA9999A" },
      contact: { designation: "Owner", email: "ravi@example.com" },
      address: { line1: "12 Main Road", pinCode: "560001" },
      business: { areasOfOperation: ["Whitefield", "Varthur"], currentProjects: "Project One", preferredSegments: ["apartments", "villas"] },
      bank: { accountHolderName: "East Realty", bankName: "Example Bank", branch: "Whitefield", accountNumber: "987654321098", ifscCode: "ABCD0123456" },
    });
    expect(update.status).toBe(200);
    expect(update.body.prospect.company.panMasked).toBe("******999A");
    expect(update.body.prospect.bank.accountNumberMasked).toBe("XXXXXXXX1098");

    const stored = await CPProspect.findById(prospect.id).select("+company.panNumberEncrypted +bank.accountNumberEncrypted").lean();
    expect(stored.company.panNumberEncrypted).not.toContain("AAAAA9999A");
    expect(stored.bank.accountNumberEncrypted).not.toContain("987654321098");

    const verification = await request(app).post(`/api/cp-prospects/mine/prospects/${prospect.id}/verification`).set("Authorization", `Bearer ${staffToken}`).send({ outcome: "active", note: "Confirmed active in Whitefield" });
    expect(verification.status).toBe(201);
    const detail = await request(app).get(`/api/cp-prospects/admin/prospects/${prospect.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.prospect.verificationStatus).toBe("active");
    expect(detail.body.interactions.map((item) => item.action)).toEqual(expect.arrayContaining(["call_started", "profile_updated", "verification_result"]));
  }, 60000);

  it("requires a future callback and keeps callbacks in the employee queue", async () => {
    const { token: adminToken } = await createAdminToken();
    const { employee, token: staffToken } = await createEmployee(adminToken, "VERIFY-002");
    const batch = await request(app).post("/api/cp-prospects/admin/imports").set("Authorization", `Bearer ${adminToken}`).send({ name: "Callbacks", originalFileName: "callbacks.csv", totalRows: 1 });
    await request(app).post(`/api/cp-prospects/admin/imports/${batch.body.batch.id}/rows`).set("Authorization", `Bearer ${adminToken}`).send({ startRow: 2, rows: [{ companyName: "Callback Realty", mobile: "9876543299", city: "Bengaluru", areasOfOperation: "Hebbal" }] });
    await request(app).post(`/api/cp-prospects/admin/imports/${batch.body.batch.id}/complete`).set("Authorization", `Bearer ${adminToken}`);
    await request(app).patch("/api/cp-prospects/admin/prospects/allocate").set("Authorization", `Bearer ${adminToken}`).send({ employeeId: employee.id, count: 1, filters: {} });
    const queue = await request(app).get("/api/cp-prospects/mine/prospects").set("Authorization", `Bearer ${staffToken}`);
    const prospectId = queue.body.prospects[0].id;

    const invalid = await request(app).post(`/api/cp-prospects/mine/prospects/${prospectId}/verification`).set("Authorization", `Bearer ${staffToken}`).send({ outcome: "callback_requested" });
    expect(invalid.status).toBe(400);
    const callbackAt = new Date(Date.now() + 3600000).toISOString();
    const saved = await request(app).post(`/api/cp-prospects/mine/prospects/${prospectId}/verification`).set("Authorization", `Bearer ${staffToken}`).send({ outcome: "callback_requested", callbackAt, note: "Call after one hour" });
    expect(saved.status).toBe(201);
    expect(await CPProspectFollowUp.countDocuments({ prospectId, status: "pending" })).toBe(1);
    const callbackQueue = await request(app).get("/api/cp-prospects/mine/prospects?status=callback_requested").set("Authorization", `Bearer ${staffToken}`);
    expect(callbackQueue.body.prospects).toHaveLength(1);
  }, 60000);

  it("keeps broker imports, allocation, and analytics separate from CP contacts", async () => {
    const { token: adminToken } = await createAdminToken();
    const { employee, token: staffToken } = await createEmployee(adminToken, "BROKER-001");
    const importOne = async (prospectType, name) => {
      const batch = await request(app).post("/api/cp-prospects/admin/imports").set("Authorization", `Bearer ${adminToken}`).send({ prospectType, name, originalFileName: `${name}.csv`, totalRows: 1 });
      expect(batch.status).toBe(201);
      const rows = await request(app).post(`/api/cp-prospects/admin/imports/${batch.body.batch.id}/rows`).set("Authorization", `Bearer ${adminToken}`).send({ startRow: 2, rows: [{ contactName: "Shared Contact", mobile: "9876543288" }] });
      expect(rows.body.imported).toBe(1);
      await request(app).post(`/api/cp-prospects/admin/imports/${batch.body.batch.id}/complete`).set("Authorization", `Bearer ${adminToken}`);
    };
    await importOne("channel_partner", "CP batch");
    await importOne("broker", "Broker batch");

    const cpAnalytics = await request(app).get("/api/cp-prospects/admin/analytics?prospectType=channel_partner").set("Authorization", `Bearer ${adminToken}`);
    const brokerAnalytics = await request(app).get("/api/cp-prospects/admin/analytics?prospectType=broker").set("Authorization", `Bearer ${adminToken}`);
    expect(cpAnalytics.body.metrics.total).toBe(1);
    expect(brokerAnalytics.body.metrics.total).toBe(1);

    const allocation = await request(app).patch("/api/cp-prospects/admin/prospects/allocate").set("Authorization", `Bearer ${adminToken}`).send({ employeeId: employee.id, count: 10, filters: { prospectType: "broker" } });
    expect(allocation.body.assignedCount).toBe(1);
    const brokers = await request(app).get("/api/cp-prospects/mine/prospects?prospectType=broker").set("Authorization", `Bearer ${staffToken}`);
    const channelPartners = await request(app).get("/api/cp-prospects/mine/prospects?prospectType=channel_partner").set("Authorization", `Bearer ${staffToken}`);
    expect(brokers.body.prospects).toHaveLength(1);
    expect(brokers.body.prospects[0].prospectType).toBe("broker");
    expect(brokers.body.metrics.total).toBe(1);
    expect(channelPartners.body.prospects).toHaveLength(0);
    expect(channelPartners.body.metrics.total).toBe(0);
  }, 60000);
});
