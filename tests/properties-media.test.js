jest.mock("cloudinary", () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload: jest.fn().mockImplementation((value, opts) =>
        Promise.resolve({
          secure_url: `https://res.cloudinary.com/demo/${opts.resource_type}/upload/mock.${
            opts.resource_type === "raw" ? "pdf" : "jpg"
          }`,
        })
      ),
    },
    api: {
      delete_resources: jest.fn().mockResolvedValue({ deleted: {} }),
    },
  },
}));

const request = require("supertest");
const app = require("../src/app");
const { createAdminToken } = require("./helpers");

describe("Property media upload (Cloudinary)", () => {
  it("converts base64 image/brochure fields to Cloudinary URLs on create", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Test Property",
        price: "50 L",
        image: "data:image/png;base64,AAAA",
        images: ["data:image/png;base64,BBBB", "https://res.cloudinary.com/demo/image/upload/existing.jpg"],
        brochure: "data:application/pdf;base64,CCCC",
      });

    expect(res.status).toBe(201);
    expect(res.body.property.image).toBe("https://res.cloudinary.com/demo/image/upload/mock.jpg");
    expect(res.body.property.images).toEqual([
      "https://res.cloudinary.com/demo/image/upload/mock.jpg",
      "https://res.cloudinary.com/demo/image/upload/existing.jpg",
    ]);
    expect(res.body.property.brochure).toBe("https://res.cloudinary.com/demo/raw/upload/mock.pdf");
  });

  it("converts base64 image field to Cloudinary URL on update", async () => {
    const { token } = await createAdminToken();
    const create = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Test Property 2", price: "50 L" });

    const id = create.body.property.id;

    const res = await request(app)
      .put(`/api/properties/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ image: "data:image/png;base64,DDDD" });

    expect(res.status).toBe(200);
    expect(res.body.property.image).toBe("https://res.cloudinary.com/demo/image/upload/mock.jpg");
  });

  it("preserves existing photos when a normal edit accidentally sends empty media arrays", async () => {
    const { token } = await createAdminToken();
    const hero = "https://res.cloudinary.com/demo/image/upload/clear-title/properties/hero-one.jpg";
    const gallery = "https://res.cloudinary.com/demo/image/upload/clear-title/properties/gallery-one.jpg";
    const property = await require("../src/models/Property").create({
      title: "Protected photos",
      price: "50 L",
      heroImages: [hero],
      images: [gallery],
    });
    expect(property.heroImages).toEqual([hero]);
    expect(property.images).toEqual([gallery]);

    const res = await request(app)
      .put(`/api/properties/${property._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ price: "55 L", heroImages: [], images: [] });

    expect(res.status).toBe(200);
    expect(res.body.property.heroImages).toEqual([hero]);
    expect(res.body.property.images).toEqual([gallery]);
    const stored = await require("../src/models/Property").findById(property._id);
    expect(stored.mediaAssets).toEqual(expect.arrayContaining([hero, gallery]));
  });

  it("updates workflow fields without touching project photos", async () => {
    const { token } = await createAdminToken();
    const hero = "https://res.cloudinary.com/demo/image/upload/clear-title/properties/workflow-hero.jpg";
    const Property = require("../src/models/Property");
    const property = await Property.create({ title: "Workflow", price: "50 L", heroImages: [hero] });

    const res = await request(app)
      .patch(`/api/properties/${property._id}/workflow`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "approved", featured: true });

    expect(res.status).toBe(200);
    expect(res.body.property.heroImages).toEqual([hero]);
    expect(res.body.property.featured).toBe(true);
  });

  it("deletes owned Cloudinary media only when the project is explicitly deleted", async () => {
    const { token } = await createAdminToken();
    const cloudinary = require("cloudinary").v2;
    const Property = require("../src/models/Property");
    const MediaCleanupJob = require("../src/models/MediaCleanupJob");
    const photo = "https://res.cloudinary.com/demo/image/upload/v1/clear-title/properties/delete-with-project.jpg";
    const property = await Property.create({
      title: "Delete project media",
      price: "50 L",
      images: [photo],
      mediaAssets: [photo],
    });

    const res = await request(app)
      .delete(`/api/properties/${property._id}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.mediaCleanup).toBe("completed");
    expect(await Property.findById(property._id)).toBeNull();
    expect(cloudinary.api.delete_resources).toHaveBeenCalledWith(
      ["clear-title/properties/delete-with-project"],
      expect.objectContaining({ resource_type: "image", invalidate: true })
    );
    expect(await MediaCleanupJob.findOne({ propertyId: String(property._id) })).toMatchObject({ status: "completed" });
  });

  it("rejects new property video and virtual-tour fields", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/properties")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Photo Only", price: "50 L", heroVideo: "https://example.com/old.mp4" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/photos only/i);
  });
});
