const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");
const ProjectQuestion = require("../src/models/ProjectQuestion");
const ProjectKnowledge = require("../src/models/ProjectKnowledge");
const DocumentExtraction = require("../src/models/DocumentExtraction");
const { createAdminToken } = require("./helpers");

describe("admin-controlled project assistant learning", () => {
  it("queues unanswered questions and reuses only an admin-approved sourced answer", async () => {
    const { token } = await createAdminToken();
    const property = await Property.create({
      title: "Trust Residency", builder: "Trust Builders", propertyType: "Apartment", status: "approved", published: true,
      reraPhases: [{ name: "Phase 1", reraNumber: "PRM/KA/RERA/11112222" }],
    });

    const missing = await request(app).post(`/api/project-assistant/${property._id}/ask`).send({ question: "Which flooring brand is supplied?" });
    expect(missing.status).toBe(200);
    expect(missing.body.unavailable).toBe(true);
    expect(missing.body.questionId).toBeTruthy();

    const queue = await request(app).get("/api/project-assistant/admin/questions?status=unanswered").set("Authorization", `Bearer ${token}`);
    expect(queue.status).toBe(200);
    expect(queue.body.questions).toHaveLength(1);
    expect(queue.body.questions[0].occurrences).toBe(1);

    const resolved = await request(app)
      .post(`/api/project-assistant/admin/questions/${missing.body.questionId}/resolve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ canonicalQuestion: "What is the project RERA number?", aliases: ["Tell me the RERA registration"], answer: "The Phase 1 RERA number is PRM/KA/RERA/11112222.", evidenceIds: ["rera-phase-1"] });
    expect(resolved.status).toBe(200);
    expect(await ProjectKnowledge.countDocuments({ property: property._id, active: true })).toBe(1);

    const reused = await request(app).post(`/api/project-assistant/${property._id}/ask`).send({ question: "Tell me the RERA registration" });
    expect(reused.status).toBe(200);
    expect(reused.body.generatedBy).toBe("approved_knowledge");
    expect(reused.body.answer).toContain("11112222");
  });

  it("moves a customer-reported answer into the needs-review queue", async () => {
    const property = await Property.create({ title: "Report Heights", propertyType: "Apartment", builder: "Report Builders", status: "approved", published: true });
    const answer = await request(app).post(`/api/project-assistant/${property._id}/ask`).send({ question: "Who is the developer?" });
    expect(answer.body.questionId).toBeTruthy();
    const report = await request(app).post(`/api/project-assistant/${property._id}/feedback`).send({ questionId: answer.body.questionId, reason: "Developer name looks wrong" });
    expect(report.status).toBe(200);
    const question = await ProjectQuestion.findById(answer.body.questionId).lean();
    expect(question.status).toBe("needs_review");
    expect(question.feedbackCount).toBe(1);
  });

  it("uses approved extracted page text and includes the document page in sources", async () => {
    const property = await Property.create({ title: "Document Home", propertyType: "Apartment", status: "approved", published: true });
    await DocumentExtraction.create({
      property: property._id, sourceKind: "project_download", documentKey: "project_download:spec", documentFingerprint: "a".repeat(64), label: "Project specifications", fileName: "specifications.pdf", fileUrl: "https://res.cloudinary.com/demo/raw/upload/clear-title/properties/project-downloads/specifications.pdf", mimeType: "application/pdf", status: "approved", extractionMethod: "embedded_text", pageCount: 1, characterCount: 38,
      pages: [{ pageNumber: 7, originalText: "Living and bedrooms use vitrified tile flooring.", reviewedText: "Living and bedrooms use vitrified tile flooring.", method: "embedded_text" }],
    });
    const answer = await request(app).post(`/api/project-assistant/${property._id}/ask`).send({ question: "What flooring is provided?" });
    expect(answer.status).toBe(200);
    expect(answer.body.answer).toContain("vitrified tile flooring");
    expect(answer.body.sources[0]).toMatchObject({ type: "uploaded_document_text", pageNumber: 7, label: "Project specifications" });
  });

  it("discovers supported project documents without extracting or approving them", async () => {
    const { token } = await createAdminToken();
    const property = await Property.create({
      title: "Queue Project", propertyType: "Apartment", status: "recheck", published: false,
      projectDownloads: [{ kind: "brochure", label: "Project brochure", fileName: "brochure.pdf", fileUrl: "https://res.cloudinary.com/demo/raw/upload/clear-title/properties/project-downloads/brochure.pdf", mimeType: "application/pdf", fileSize: 1000 }],
    });
    const discovery = await request(app).post("/api/project-assistant/admin/documents/discover").set("Authorization", `Bearer ${token}`).send({ propertyId: property._id });
    expect(discovery.status).toBe(200);
    expect(discovery.body).toMatchObject({ discovered: 1, created: 1 });
    const extraction = await DocumentExtraction.findOne({ property: property._id }).lean();
    expect(extraction.status).toBe("queued");
    expect(extraction.pages).toHaveLength(0);
  });
});
