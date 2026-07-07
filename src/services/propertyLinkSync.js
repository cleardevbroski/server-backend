const Builder = require("../models/Builder");
const Dealer = require("../models/Dealer");
const Property = require("../models/Property");

async function decrementBuilderCount(builderId) {
  await Builder.updateOne({ _id: builderId, projectCount: { $gt: 0 } }, { $inc: { projectCount: -1 } });
}

async function linkProperty(property) {
  if (property.builderId) {
    await Builder.findByIdAndUpdate(property.builderId, { $inc: { projectCount: 1 } });
  }
  if (property.dealerId) {
    await Dealer.findByIdAndUpdate(property.dealerId, { $addToSet: { propertyIds: property._id } });
  }
}

async function unlinkProperty(property) {
  if (property.builderId) {
    await decrementBuilderCount(property.builderId);
  }
  if (property.dealerId) {
    await Dealer.findByIdAndUpdate(property.dealerId, { $pull: { propertyIds: property._id } });
  }
}

async function relinkProperty(oldProperty, newBuilderId, newDealerId) {
  const oldBuilderId = oldProperty.builderId ? oldProperty.builderId.toString() : null;
  const oldDealerId = oldProperty.dealerId ? oldProperty.dealerId.toString() : null;
  const nextBuilderId = newBuilderId ? newBuilderId.toString() : null;
  const nextDealerId = newDealerId ? newDealerId.toString() : null;

  if (oldBuilderId !== nextBuilderId) {
    if (oldBuilderId) {
      await decrementBuilderCount(oldBuilderId);
    }
    if (nextBuilderId) {
      await Builder.findByIdAndUpdate(nextBuilderId, { $inc: { projectCount: 1 } });
    }
  }

  if (oldDealerId !== nextDealerId) {
    if (oldDealerId) {
      await Dealer.findByIdAndUpdate(oldDealerId, { $pull: { propertyIds: oldProperty._id } });
    }
    if (nextDealerId) {
      await Dealer.findByIdAndUpdate(nextDealerId, { $addToSet: { propertyIds: oldProperty._id } });
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
