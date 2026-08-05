const request = require("supertest");
const app = require("../src/app");

describe("Channel partner media API", () => {
  it("rejects unknown document kinds", async () => {
    const res = await request(app)
      .post("/api/channel-partner-media?kind=unknown")
      .set("Content-Type", "image/png")
      .send(Buffer.from("not-an-image"));
    expect(res.status).toBe(400);
  });

  it("does not accept a PDF as a signature", async () => {
    const res = await request(app)
      .post("/api/channel-partner-media?kind=signature")
      .set("Content-Type", "application/pdf")
      .send(Buffer.from("%PDF-test"));
    expect(res.status).toBe(415);
  });

  it("rejects an upload whose declared size exceeds 10 MB", async () => {
    const res = await request(app)
      .post("/api/channel-partner-media?kind=pan-card")
      .set("Content-Type", "application/pdf")
      .set("Content-Length", String(10 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
  });
});
