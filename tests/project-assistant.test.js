const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");

describe("grounded project assistant", () => {
  it("answers from project evidence and returns source records without requiring AI configuration", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_PROJECT_ASSISTANT_MODEL;
    const property = await Property.create({
      title: "Evidence Heights",
      builder: "Evidence Builders",
      propertyType: "Apartment",
      status: "approved",
      published: true,
      reraRegistered: true,
      reraPhases: [{ name: "Phase 1", reraNumber: "PRM/KA/RERA/12345678", officialDetails: { registeredCompletionDate: "31-03-2027" } }],
    });
    const response = await request(app).post(`/api/project-assistant/${property._id}/ask`).send({ question: "What is the RERA number and completion date?" });
    expect(response.status).toBe(200);
    expect(response.body.answer).toContain("PRM/KA/RERA/12345678");
    expect(response.body.answer).toContain("31-03-2027");
    expect(response.body.sources[0]).toMatchObject({ type: "rera_record", phase: "Phase 1" });
    expect(response.body.sources[0].fileUrl).toBeUndefined();
  });

  it("does not pretend that document contents are known from a file name", async () => {
    const property = await Property.create({
      title: "Document Only",
      propertyType: "Apartment",
      status: "approved",
      published: true,
      reraPhases: [{ name: "Phase 1", reraNumber: "PRM/KA/RERA/87654321", projectDocuments: [{ key: "brochure", label: "Project brochure", fileName: "brochure.pdf", fileUrl: "https://example.com/brochure.pdf", mimeType: "application/pdf", fileSize: 1000 }] }],
    });
    const response = await request(app).post(`/api/project-assistant/${property._id}/ask`).send({ question: "What flooring brand is in the brochure?" });
    expect(response.status).toBe(200);
    expect(response.body.unavailable).toBe(true);
  });
});
