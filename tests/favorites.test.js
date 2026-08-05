const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../src/app");
const User = require("../src/models/User");
const Property = require("../src/models/Property");
const FavoriteProperty = require("../src/models/FavoriteProperty");
const { createAdminToken, createUserToken } = require("./helpers");

describe("customer saved properties", () => {
  it("requires customer authentication and validates property availability", async () => {
    const property = await Property.create({ title: "Available Home", status: "approved", published: true });
    expect((await request(app).post(`/api/favorites/${property._id}`)).status).toBe(401);

    const { token } = await createUserToken();
    expect((await request(app).post("/api/favorites/not-an-id").set("Authorization", `Bearer ${token}`)).status).toBe(404);
    const hidden = await Property.create({ title: "Hidden Home", status: "pending", published: false });
    expect((await request(app).post(`/api/favorites/${hidden._id}`).set("Authorization", `Bearer ${token}`)).status).toBe(404);
  });

  it("saves idempotently, lists in account order, and removes a favorite", async () => {
    const { token } = await createUserToken();
    const property = await Property.create({ title: "Lake View", subtitle: "Whitefield", status: "approved", published: true });
    const first = await request(app).post(`/api/favorites/${property._id}`).set("Authorization", `Bearer ${token}`);
    const repeated = await request(app).post(`/api/favorites/${property._id}`).set("Authorization", `Bearer ${token}`);
    expect(first.status).toBe(201);
    expect(repeated.status).toBe(200);
    expect(await FavoriteProperty.countDocuments()).toBe(1);

    const ids = await request(app).get("/api/favorites/ids").set("Authorization", `Bearer ${token}`);
    const list = await request(app).get("/api/favorites").set("Authorization", `Bearer ${token}`);
    expect(ids.body.propertyIds).toEqual([property._id.toString()]);
    expect(list.body.properties[0]).toMatchObject({ id: property._id.toString(), title: "Lake View" });

    expect((await request(app).delete(`/api/favorites/${property._id}`).set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect(await FavoriteProperty.countDocuments()).toBe(0);
  });

  it("keeps each customer's watchlist private", async () => {
    const first = await createUserToken();
    const secondUser = await User.create({ phone: "9000000003", role: "user", isVerified: true });
    const secondToken = jwt.sign({ userId: secondUser._id, phone: secondUser.phone, role: "user" }, process.env.JWT_SECRET, { expiresIn: "1h" });
    const property = await Property.create({ title: "Private Choice", status: "approved", published: true });
    await request(app).post(`/api/favorites/${property._id}`).set("Authorization", `Bearer ${first.token}`);

    const secondList = await request(app).get("/api/favorites").set("Authorization", `Bearer ${secondToken}`);
    expect(secondList.body.properties).toEqual([]);
  });

  it("cleans watchlists when an admin deletes a property", async () => {
    const customer = await createUserToken();
    const property = await Property.create({ title: "Soon Deleted", status: "approved", published: true });
    await request(app).post(`/api/favorites/${property._id}`).set("Authorization", `Bearer ${customer.token}`);
    const admin = await createAdminToken();
    expect((await request(app).delete(`/api/properties/${property._id}`).set("Authorization", `Bearer ${admin.token}`)).status).toBe(200);
    expect(await FavoriteProperty.countDocuments()).toBe(0);
  });
});
