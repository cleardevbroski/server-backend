const CPProspect = require("../models/CPProspect");

const LEGACY_PARALLEL_ARRAY_INDEX = "address.city_1_business.areasOfOperation_1_business.preferredSegments_1";

async function migrateCPProspectIndexes() {
  let indexes = [];
  try {
    indexes = await CPProspect.collection.indexes();
  } catch (error) {
    if (error.code !== 26 && error.codeName !== "NamespaceNotFound") throw error;
  }
  if (indexes.some((index) => index.name === LEGACY_PARALLEL_ARRAY_INDEX)) {
    await CPProspect.collection.dropIndex(LEGACY_PARALLEL_ARRAY_INDEX).catch((error) => {
      if (error.code !== 27 && error.codeName !== "IndexNotFound") throw error;
    });
  }

  await Promise.all([
    CPProspect.collection.createIndex({ "business.areasOfOperation": 1 }),
    CPProspect.collection.createIndex({ "business.preferredSegments": 1 }),
  ]);
}

module.exports = { migrateCPProspectIndexes };
