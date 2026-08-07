const request = require("supertest");
const app = require("../src/app");
const { createAdminToken, createUserToken } = require("./helpers");

describe("optional property fields", () => {
  it("allows an admin to create every property type with no additional details", async () => {
    const { token } = await createAdminToken();
    for (const propertyType of ["Apartment", "Villa", "Plot", "Commercial", "PG/Co-living"]) {
      const response = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send({ propertyType });
      expect(response.status).toBe(201);
      expect(response.body.property).toMatchObject({ propertyType });
      expect(response.body.property.title).toBeUndefined();
      expect(response.body.property.price).toBeUndefined();
      expect(response.body.property.image).toBeFalsy();
      expect(response.body.property).toMatchObject({ status: "pending", published: false });
    }
  });

  it.each(["Rent", "Lease"])("rejects the retired %s property type", async (propertyType) => {
    const { token } = await createAdminToken();
    const response = await request(app).post("/api/properties").set("Authorization", `Bearer ${token}`).send({ propertyType });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/no longer supported/i);
  });

  it("allows a public submission with only the fields a customer entered", async () => {
    const { token } = await createUserToken();
    const response = await request(app)
      .post("/api/properties/public")
      .set("Authorization", `Bearer ${token}`)
      .send({ propertyType: "Plot", title: "Corner site", plotDetails: { approvalNumber: "BDA-123" } });

    expect(response.status).toBe(201);
    expect(response.body.property).toMatchObject({ propertyType: "Plot", title: "Corner site", plotDetails: { approvalNumber: "BDA-123" } });
    expect(response.body.property).not.toHaveProperty("price");
  });
});
