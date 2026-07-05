const request = require("supertest");
const app = require("../src/app");
const { createAdminToken } = require("./helpers");

describe("CMS Endpoints Authentication", () => {
  it("allows public GET requests to testimonials", async () => {
    const res = await request(app).get("/api/cms/testimonials");
    expect(res.status).toBe(200);
  });

  it("blocks unauthenticated POST requests to testimonials", async () => {
    const res = await request(app)
      .post("/api/cms/testimonials")
      .send({ quote: "Great service!", name: "John Doe", role: "Customer" });
    
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/No token provided/i);
  });

  it("allows authenticated admin POST requests to testimonials", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/cms/testimonials")
      .set("Authorization", `Bearer ${token}`)
      .send({ quote: "Great service!", name: "John Doe", role: "Customer" });
    
    if (res.status !== 201) console.error("ERROR:", res.status, res.body);

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("John Doe");
  });
});
