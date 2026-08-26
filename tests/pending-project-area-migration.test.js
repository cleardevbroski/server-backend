const Property = require("../src/models/Property");
const { migratePendingProjectAreaUnits } = require("../src/services/pendingProjectAreaMigration");

describe("pending project-area migration", () => {
  beforeEach(async () => {
    await Property.deleteMany({});
  });

  it("copies legacy component values 1:1 into sqft fields without changing total acres or updatedAt", async () => {
    const originalUpdatedAt = new Date("2026-01-02T03:04:05.000Z");
    const pending = await Property.collection.insertOne({
      title: "Pending legacy project",
      status: "pending",
      published: false,
      updatedAt: originalUpdatedAt,
      projectArea: { totalAcres: 3, openSpaceAcres: 3000, builtUpAcres: 12000, amenitiesAcres: 1500 },
    });
    const published = await Property.collection.insertOne({
      title: "Published legacy project",
      status: "published",
      published: true,
      projectArea: { totalAcres: 4, openSpaceAcres: 4000 },
    });

    const first = await migratePendingProjectAreaUnits();
    expect(first).toMatchObject({ matched: 1, migratedCount: 1 });
    const migrated = await Property.collection.findOne({ _id: pending.insertedId });
    expect(migrated.projectArea).toEqual({ totalAcres: 3, openSpaceSqft: 3000, builtUpSqft: 12000, amenitiesSqft: 1500 });
    expect(migrated.updatedAt).toEqual(originalUpdatedAt);

    const untouched = await Property.collection.findOne({ _id: published.insertedId });
    expect(untouched.projectArea).toEqual({ totalAcres: 4, openSpaceAcres: 4000 });
    expect(await migratePendingProjectAreaUnits()).toMatchObject({ matched: 0, migratedCount: 0 });
  });
});
