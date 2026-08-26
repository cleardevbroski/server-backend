const Property = require("../models/Property");

const LEGACY_TO_SQFT = {
  openSpaceAcres: "openSpaceSqft",
  builtUpAcres: "builtUpSqft",
  amenitiesAcres: "amenitiesSqft",
};

/**
 * Moves component-area values from the old, incorrectly named acre fields to
 * square-foot fields. Historical values are already square feet, so this is a
 * strict 1:1 copy. Raw collection updates intentionally preserve updatedAt.
 */
async function migratePendingProjectAreaUnits({ dryRun = false } = {}) {
  const filter = {
    $and: [
      { published: { $ne: true } },
      { status: { $nin: ["approved", "published"] } },
      { $or: Object.keys(LEGACY_TO_SQFT).map((field) => ({ [`projectArea.${field}`]: { $exists: true } })) },
    ],
  };
  const projection = { title: 1, status: 1, published: 1, projectArea: 1 };
  const records = await Property.collection.find(filter, { projection }).toArray();
  const operations = [];
  const migrated = [];

  for (const record of records) {
    const area = record.projectArea || {};
    const set = {};
    const unset = {};
    const copied = {};

    for (const [legacyField, sqftField] of Object.entries(LEGACY_TO_SQFT)) {
      if (area[legacyField] === undefined) continue;
      if (area[sqftField] === undefined) {
        set[`projectArea.${sqftField}`] = area[legacyField];
        copied[sqftField] = area[legacyField];
      }
      unset[`projectArea.${legacyField}`] = "";
    }
    if (!Object.keys(unset).length) continue;
    operations.push({ updateOne: { filter: { _id: record._id }, update: { ...(Object.keys(set).length ? { $set: set } : {}), $unset: unset } } });
    migrated.push({ id: String(record._id), title: record.title || "Untitled property", copied });
  }

  if (!dryRun && operations.length) await Property.collection.bulkWrite(operations, { ordered: false });
  return { dryRun, matched: records.length, migratedCount: migrated.length, migrated };
}

module.exports = { migratePendingProjectAreaUnits };
