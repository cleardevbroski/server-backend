const request = require("supertest");
const app = require("../src/app");
const Property = require("../src/models/Property");

describe("anonymous family decision workspaces", () => {
  it("creates a secure workspace and supports notes, questions and nickname votes", async () => {
    const property = await Property.create({ title: "Shared Home", propertyType: "Apartment", status: "approved", published: true });
    const created = await request(app).post("/api/decision-workspaces").send({ propertyIds: [String(property._id)] });
    expect(created.status).toBe(201);
    expect(created.body.ownerToken).toBeTruthy();
    expect(created.body.shareToken).toBeTruthy();
    const url = `/api/decision-workspaces/${created.body.workspaceId}`;
    expect((await request(app).get(url)).status).toBe(401);

    const note = await request(app).patch(`${url}/properties/${property._id}`).set("X-Workspace-Token", created.body.shareToken).send({ note: "Ask about parking", questions: ["Is parking included?"] });
    expect(note.status).toBe(200);
    const vote = await request(app).post(`${url}/properties/${property._id}/votes`).set("X-Workspace-Token", created.body.shareToken).send({ participantId: "member-1", nickname: "Anu", vote: "prefer" });
    expect(vote.status).toBe(200);
    const loaded = await request(app).get(url).set("X-Workspace-Token", created.body.ownerToken);
    expect(loaded.body.workspace.items[0].note).toBe("Ask about parking");
    expect(loaded.body.workspace.items[0].votes[0]).toMatchObject({ nickname: "Anu", vote: "prefer" });
    expect((await request(app).get(`${url}/summary`).set("X-Workspace-Token", created.body.ownerToken)).body.summary.properties[0].title).toBe("Shared Home");
  });

  it("limits comparison workspaces to three projects", async () => {
    const properties = await Property.create([1, 2, 3, 4].map((number) => ({ title: `Home ${number}`, propertyType: "Apartment", status: "approved", published: true })));
    const created = await request(app).post("/api/decision-workspaces").send({ propertyIds: properties.slice(0, 3).map((property) => property._id) });
    const response = await request(app).post(`/api/decision-workspaces/${created.body.workspaceId}/properties`).set("X-Workspace-Token", created.body.ownerToken).send({ propertyId: properties[3]._id });
    expect(response.status).toBe(409);
  });

  it("keeps family chat inside the secure workspace and protects message removal", async () => {
    const property = await Property.create({ title: "Chat Home", propertyType: "Villa", status: "approved", published: true });
    const created = await request(app).post("/api/decision-workspaces").send({ propertyIds: [property._id] });
    const base = `/api/decision-workspaces/${created.body.workspaceId}/messages`;

    expect((await request(app).get(base).set("X-Participant-Id", "member-1")).status).toBe(401);
    const sent = await request(app).post(base)
      .set("X-Workspace-Token", created.body.shareToken)
      .set("X-Participant-Id", "member-1")
      .send({ nickname: "Anu", message: "Can we verify the garden size?", propertyId: property._id });
    expect(sent.status).toBe(201);
    expect(sent.body.message).toMatchObject({ nickname: "Anu", propertyTitle: "Chat Home", isMine: true, canDelete: true });
    expect(sent.body.message.participantHash).toBeUndefined();

    const familyView = await request(app).get(base)
      .set("X-Workspace-Token", created.body.shareToken)
      .set("X-Participant-Id", "member-2");
    expect(familyView.status).toBe(200);
    expect(familyView.body.messages[0]).toMatchObject({ message: "Can we verify the garden size?", isMine: false, canDelete: false });

    const forbidden = await request(app).delete(`${base}/${sent.body.message.id}`)
      .set("X-Workspace-Token", created.body.shareToken)
      .set("X-Participant-Id", "member-2");
    expect(forbidden.status).toBe(403);

    const removed = await request(app).delete(`${base}/${sent.body.message.id}`)
      .set("X-Workspace-Token", created.body.ownerToken)
      .set("X-Participant-Id", "owner-device");
    expect(removed.status).toBe(200);
    expect(removed.body.message).toMatchObject({ message: "", deletedAt: expect.any(String) });
  });
});
