const request = require("supertest");
const app = require("../src/app");
const HeroBanner = require("../src/models/HeroBanner");
const Property = require("../src/models/Property");
const { createAdminToken } = require("./helpers");

describe("Hero Banners API", () => {
  it("returns no custom public banners until an active ranked property is assigned", async () => {
    await HeroBanner.create({ image: "a.jpg", title: "A", order: 2, published: true });
    await HeroBanner.create({ image: "b.jpg", title: "B", order: 1, published: true });
    await HeroBanner.create({ image: "c.jpg", title: "C", order: 0, published: false });
    const res = await request(app).get("/api/hero/banners");
    expect(res.status).toBe(200);
    expect(res.body.banners).toEqual([]);
  });

  it("rejects create without an admin token", async () => {
    const res = await request(app).post("/api/hero/banners").send({ image: "a.jpg", title: "X" });
    expect(res.status).toBe(401);
  });

  it("creates a banner with an admin token", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/hero/banners")
      .set("Authorization", `Bearer ${token}`)
      .send({ image: "a.jpg", title: "New Banner" });
    expect(res.status).toBe(201);
    expect(res.body.banner.title).toBe("New Banner");
  });

  it("creates a property-linked homepage feature with isolated extra details", async () => {
    const { token } = await createAdminToken();
    const property = await Property.create({
      title: "Linked Property",
      subtitle: "Whitefield, Bangalore",
      price: "₹1.2 Cr",
      builder: "Clear Builder",
      image: "cover.jpg",
      heroImages: ["hero.jpg"],
      propertyType: "Apartment",
      status: "approved",
      published: true,
    });

    const res = await request(app)
      .post("/api/hero/banners")
      .set("Authorization", `Bearer ${token}`)
      .send({
        propertyId: property._id.toString(),
        selectedFields: ["title", "price", "not-supported"],
        fieldOverrides: { price: "From ₹1 Cr", privateField: "hidden" },
        extraDetails: [{ id: "offer", label: "Special offer", value: "No registration fee", enabled: true, order: 0 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.banner).toMatchObject({
      propertyId: property._id.toString(),
      image: "hero.jpg",
      title: "Linked Property",
      linkType: "property",
      linkValue: property._id.toString(),
      selectedFields: ["title", "price"],
      fieldOverrides: { price: "From ₹1 Cr" },
    });
    expect(res.body.banner.extraDetails[0].label).toBe("Special offer");

    const unchanged = await Property.findById(property._id).lean();
    expect(unchanged.price).toBe("₹1.2 Cr");
  });

  it("rejects linking an unpublished property", async () => {
    const { token } = await createAdminToken();
    const property = await Property.create({
      title: "Draft Property",
      price: "₹80 Lac",
      image: "draft.jpg",
      status: "draft",
      published: false,
    });

    const res = await request(app)
      .post("/api/hero/banners")
      .set("Authorization", `Bearer ${token}`)
      .send({ propertyId: property._id.toString() });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/approved and published/i);
  });

  it("lets admins see hidden homepage features while keeping them out of the public list", async () => {
    const { token } = await createAdminToken();
    await HeroBanner.create({ image: "hidden.jpg", title: "Hidden", displayOnHomepage: false, published: true });

    const [publicRes, adminRes] = await Promise.all([
      request(app).get("/api/hero/banners"),
      request(app).get("/api/hero/banners/admin").set("Authorization", `Bearer ${token}`),
    ]);

    expect(publicRes.body.banners.some((banner) => banner.title === "Hidden")).toBe(false);
    expect(adminRes.body.banners.some((banner) => banner.title === "Hidden")).toBe(true);
  });

  it("excludes a linked feature when its source property is no longer available", async () => {
    const property = await Property.create({
      title: "Temporary Property",
      price: "₹90 Lac",
      image: "temporary.jpg",
      status: "approved",
      published: true,
    });
    await HeroBanner.create({
      image: "temporary.jpg",
      title: "Temporary Feature",
      propertyId: property._id,
      linkType: "property",
      linkValue: property._id.toString(),
    });
    await Property.findByIdAndDelete(property._id);

    const res = await request(app).get("/api/hero/banners");

    expect(res.status).toBe(200);
    expect(res.body.banners.some((banner) => banner.title === "Temporary Feature")).toBe(false);
  });

  it("supports an independently published promotion slot and resolves current property data with overrides", async () => {
    const { token } = await createAdminToken();
    const property = await Property.create({
      title: "Original title",
      subtitle: "Whitefield",
      price: "₹1 Cr",
      image: "original.jpg",
      configs: ["2 BHK"],
      status: "approved",
      published: true,
    });
    await HeroBanner.create({ image: "legacy.jpg", title: "Legacy fallback", published: true });

    const created = await request(app)
      .post("/api/hero/banners")
      .set("Authorization", `Bearer ${token}`)
      .send({
        propertyId: property._id.toString(),
        promotionSlot: "gold",
        image: "promotion.jpg",
        fieldOverrides: { price: "Special ₹95 Lac" },
        additionalInformation: { enabled: true, values: {} },
      });

    expect(created.status).toBe(201);
    expect(created.body.banner).toMatchObject({ promotionSlot: "gold", rank: 2, order: 1 });

    await Property.findByIdAndUpdate(property._id, { title: "Updated title", price: "₹1.1 Cr" });
    const publicRes = await request(app).get("/api/hero/banners");

    expect(publicRes.body.banners).toHaveLength(1);
    expect(publicRes.body.banners[0]).toMatchObject({
      promotionSlot: "gold",
      rank: 2,
      title: "Updated title",
      priceText: "Special ₹95 Lac",
      image: "promotion.jpg",
    });
    expect(publicRes.body.banners[0].resolvedDetails.configuration).toBe("2 BHK");
  });

  it("prevents duplicate slot and property assignments while allowing other slots to remain empty", async () => {
    const { token } = await createAdminToken();
    const first = await Property.create({ title: "First", price: "₹1 Cr", image: "first.jpg", status: "approved", published: true });
    const second = await Property.create({ title: "Second", price: "₹2 Cr", image: "second.jpg", status: "approved", published: true });

    const firstSlot = await request(app)
      .post("/api/hero/banners")
      .set("Authorization", `Bearer ${token}`)
      .send({ propertyId: first._id.toString(), promotionSlot: "diamond" });
    expect(firstSlot.status).toBe(201);

    const duplicateSlot = await request(app)
      .post("/api/hero/banners")
      .set("Authorization", `Bearer ${token}`)
      .send({ propertyId: second._id.toString(), promotionSlot: "diamond" });
    expect(duplicateSlot.status).toBe(409);
    expect(duplicateSlot.body.error).toMatch(/already occupied/i);

    const duplicateProperty = await request(app)
      .post("/api/hero/banners")
      .set("Authorization", `Bearer ${token}`)
      .send({ propertyId: first._id.toString(), promotionSlot: "silver" });
    expect(duplicateProperty.status).toBe(409);
    expect(duplicateProperty.body.error).toMatch(/another promotion slot/i);

    const publicRes = await request(app).get("/api/hero/banners");
    expect(publicRes.body.banners.map((banner) => banner.promotionSlot)).toEqual(["diamond"]);
  });

  it("rotates only the independently active ranked properties in rank order", async () => {
    const diamondProperty = await Property.create({ title: "Diamond Property", price: "₹3 Cr", image: "diamond.jpg", status: "approved", published: true });
    const silverProperty = await Property.create({ title: "Silver Property", price: "₹1 Cr", image: "silver.jpg", status: "approved", published: true });
    await HeroBanner.create({
      image: "silver.jpg",
      title: "Silver Property",
      propertyId: silverProperty._id,
      promotionSlot: "silver",
      order: 2,
      published: true,
      displayOnHomepage: true,
    });
    await HeroBanner.create({
      image: "diamond.jpg",
      title: "Diamond Property",
      propertyId: diamondProperty._id,
      promotionSlot: "diamond",
      order: 0,
      published: true,
      displayOnHomepage: true,
    });
    await HeroBanner.create({ image: "legacy.jpg", title: "Legacy", published: true });

    const res = await request(app).get("/api/hero/banners");

    expect(res.status).toBe(200);
    expect(res.body.banners.map((banner) => banner.promotionSlot)).toEqual(["diamond", "silver"]);
    expect(res.body.banners.map((banner) => banner.title)).toEqual(["Diamond Property", "Silver Property"]);
  });

  it("updates banner order via PATCH /:id/order", async () => {
    const { token } = await createAdminToken();
    const banner = await HeroBanner.create({ image: "a.jpg", title: "A", order: 0 });
    const res = await request(app)
      .patch(`/api/hero/banners/${banner._id}/order`)
      .set("Authorization", `Bearer ${token}`)
      .send({ order: 5 });
    expect(res.status).toBe(200);
    expect(res.body.banner.order).toBe(5);
  });

  it("deletes a banner", async () => {
    const { token } = await createAdminToken();
    const banner = await HeroBanner.create({ image: "a.jpg", title: "A" });
    const res = await request(app)
      .delete(`/api/hero/banners/${banner._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
