const Builder = require("../models/Builder");
const Property = require("../models/Property");

async function decrementBuilderCount(builderId) {
  await Builder.updateOne({ _id: builderId, projectCount: { $gt: 0 } }, { $inc: { projectCount: -1 } });
}

async function linkProperty(property) {
  if (property.builderId) {
    await Builder.findByIdAndUpdate(property.builderId, { $inc: { projectCount: 1 } });
  }
}

async function unlinkProperty(property) {
  if (property.builderId) {
    await decrementBuilderCount(property.builderId);
  }
}

async function relinkProperty(oldProperty, newBuilderId) {
  const oldBuilderId = oldProperty.builderId ? oldProperty.builderId.toString() : null;
  const nextBuilderId = newBuilderId ? newBuilderId.toString() : null;

  if (oldBuilderId !== nextBuilderId) {
    if (oldBuilderId) {
      await decrementBuilderCount(oldBuilderId);
    }
    if (nextBuilderId) {
      await Builder.findByIdAndUpdate(nextBuilderId, { $inc: { projectCount: 1 } });
    }
  }
}

async function unsetBuilderRef(builderId) {
  await Property.updateMany({ builderId }, { $set: { builderId: null } });
}

async function unsetDealerRef(dealerId) {
  await Property.updateMany({ dealerId }, { $set: { dealerId: null } });
}

module.exports = { linkProperty, unlinkProperty, relinkProperty, unsetBuilderRef, unsetDealerRef };
