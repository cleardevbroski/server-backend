const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const { createAdminToken } = require("./helpers");

async function registerCustomer(overrides = {}) {
  const payload = {
    name: "Public Owner",
    phone: "9876543210",
    email: "owner@example.com",
    password: "StrongPass123",
    ...overrides,
  };
  const response = await request(app).post("/api/auth/register").send(payload);
  expect(response.status).toBe(201);
  return response.body;
}

describe("customer property moderation workflow", () => {
  it("registers, logs in and resets a forgotten password", async () => {
    await registerCustomer();
    const login = await request(app).post("/api/auth/login").send({ email: "owner@example.com", password: "StrongPass123" });
    expect(login.status).toBe(200);

    const forgot = await request(app).post("/api/auth/forgot-password").send({ email: "owner@example.com" });
    expect(forgot.status).toBe(200);
    const resetUrl = new URL(forgot.body.devResetUrl);
    const reset = await request(app).post("/api/auth/reset-password").send({
      email: "owner@example.com",
      token: resetUrl.searchParams.get("resetToken"),
      password: "NewStrongPass123",
    });
    expect(reset.status).toBe(200);
    const relogin = await request(app).post("/api/auth/login").send({ email: "owner@example.com", password: "NewStrongPass123" });
    expect(relogin.status).toBe(200);
  });

  it("requires authentication and records ownership on submission", async () => {
    const unauthorized = await request(app).post("/api/properties/public").send({ title: "Owner Home", price: "1 Cr" });
    expect(unauthorized.status).toBe(401);

    const customer = await registerCustomer();
    const submitted = await request(app)
      .post("/api/properties/public")
      .set("Authorization", `Bearer ${customer.token}`)
      .send({ title: "Owner Home", subtitle: "Whitefield", price: "1 Cr", submittedBy: "admin" });
    expect(submitted.status).toBe(201);
    expect(submitted.body.property.status).toBe("submitted");
    expect(submitted.body.property.submittedBy).toBe("user");
    expect(String(submitted.body.property.postedBy)).toBe(String(customer.user.id));
  });

  it("supports request changes, customer resubmission, and verified publication", async () => {
    const customer = await registerCustomer();
    const create = await request(app).post("/api/properties/public").set("Authorization", `Bearer ${customer.token}`).send({ title: "Review Home", subtitle: "East", price: "90 L" });
    const id = create.body.property.id;
    const { token: adminToken } = await createAdminToken();

    const changes = await request(app).put(`/api/properties/admin/submissions/${id}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "request_changes", message: "Upload a clearer ownership document." });
    expect(changes.status).toBe(200);
    expect(changes.body.property.status).toBe("changes_requested");

    const resubmit = await request(app).put(`/api/properties/my/${id}/resubmit`).set("Authorization", `Bearer ${customer.token}`).send({ title: "Review Home Updated", subtitle: "East", price: "90 L" });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.property.status).toBe("resubmitted");
    expect(resubmit.body.property.submissionVersion).toBe(2);

    const publish = await request(app).put(`/api/properties/admin/submissions/${id}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "publish" });
    expect(publish.status).toBe(200);
    expect(publish.body.property.status).toBe("published");
    expect(publish.body.property.verified).toBe(true);

    const publicProperty = await request(app).get(`/api/properties/${id}`);
    expect(publicProperty.status).toBe(200);
    expect(await Property.countDocuments({ _id: id, published: true })).toBe(1);
  });
});
