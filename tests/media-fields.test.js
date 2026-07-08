jest.mock("cloudinary", () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload: jest.fn().mockResolvedValue({
        secure_url: "https://res.cloudinary.com/demo/image/upload/mock.jpg",
      }),
    },
  },
}));

const request = require("supertest");
const app = require("../src/app");
const { createAdminToken } = require("./helpers");

describe("Single-image field upload (Cloudinary)", () => {
  it("converts a hero banner's base64 image to a Cloudinary URL", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/hero/banners")
      .set("Authorization", `Bearer ${token}`)
      .send({ image: "data:image/png;base64,AAAA", title: "Banner" });

    expect(res.status).toBe(201);
    expect(res.body.banner.image).toBe("https://res.cloudinary.com/demo/image/upload/mock.jpg");
  });

  it("converts a builder's base64 logo to a Cloudinary URL", async () => {
    const { token } = await createAdminToken();
    const res = await request(app)
      .post("/api/builders")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Test Builder", slug: "test-builder", logo: "data:image/png;base64,AAAA" });

    expect(res.status).toBe(201);
    expect(res.body.builder.logo).toBe("https://res.cloudinary.com/demo/image/upload/mock.jpg");
  });
});
