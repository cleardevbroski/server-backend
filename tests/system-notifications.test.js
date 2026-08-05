const request = require("supertest");
const app = require("../src/app");
const SystemNotification = require("../src/models/SystemNotification");
const { createAdminToken } = require("./helpers");

describe("system error notifications", () => {
  it("accepts sanitized browser reports and groups repeated errors", async () => {
    const payload = { message: "Cannot read properties of undefined", path: "/admin", componentStack: "at PropertyTable" };
    expect((await request(app).post("/api/system-notifications/report").send(payload)).status).toBe(202);
    expect((await request(app).post("/api/system-notifications/report").send(payload)).status).toBe(202);

    const stored = await SystemNotification.findOne();
    expect(stored).toMatchObject({ message: payload.message, path: "/admin", occurrences: 2, unread: true });
  });

  it("protects the admin inbox and supports read state", async () => {
    await request(app).post("/api/system-notifications/report").send({ message: "Render failed", path: "/property/example" });
    expect((await request(app).get("/api/system-notifications/admin")).status).toBe(401);

    const { token } = await createAdminToken();
    const list = await request(app).get("/api/system-notifications/admin").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.unreadCount).toBe(1);

    const id = list.body.notifications[0].id;
    expect((await request(app).patch(`/api/system-notifications/admin/${id}/read`).set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect((await SystemNotification.findById(id)).unread).toBe(false);
  });

  it("marks all notifications as read", async () => {
    await Promise.all([
      request(app).post("/api/system-notifications/report").send({ message: "Error A", path: "/a" }),
      request(app).post("/api/system-notifications/report").send({ message: "Error B", path: "/b" }),
    ]);
    const { token } = await createAdminToken();
    const response = await request(app).patch("/api/system-notifications/admin/read-all").set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(await SystemNotification.countDocuments({ unread: true })).toBe(0);
  });
});
