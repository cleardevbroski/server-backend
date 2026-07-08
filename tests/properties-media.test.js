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
});
