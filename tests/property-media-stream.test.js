jest.mock("cloudinary", () => {
  const { Writable } = require("stream");
  return {
    v2: {
      config: jest.fn(),
      uploader: {
        upload: jest.fn(),
        upload_stream: jest.fn((options, callback) => new Writable({
          write(_chunk, _encoding, done) { done(); },
          final(done) {
            callback(null, { secure_url: `https://res.cloudinary.com/demo/${options.resource_type}/upload/streamed` });
            done();
          },
        })),
      },
    },
  };
});

const request = require("supertest");
const app = require("../src/app");

describe("streamed property media upload", () => {
  it("streams a valid PNG without JSON/base64 encoding", async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("test-image"),
    ]);
    const res = await request(app)
      .post("/api/property-media?kind=image")
      .set("Content-Type", "image/png")
      .send(png);
    expect(res.status).toBe(201);
    expect(res.body.url).toContain("/image/upload/streamed");
  });

  it("rejects an unsupported declared MIME type", async () => {
    const res = await request(app)
      .post("/api/property-media?kind=brochure")
      .set("Content-Type", "text/plain")
      .send(Buffer.from("not a pdf"));
    expect(res.status).toBe(415);
  });

  it("rejects content whose signature does not match its MIME type", async () => {
    const res = await request(app)
      .post("/api/property-media?kind=brochure")
      .set("Content-Type", "application/pdf")
      .send(Buffer.from("not a pdf"));
    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/does not match/i);
  });

  it("rejects a declared payload larger than the kind limit before streaming", async () => {
    const res = await request(app)
      .post("/api/property-media?kind=image")
      .set("Content-Type", "image/png")
      .set("Content-Length", String(5 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
  });
});
