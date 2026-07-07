const Builder = require("../models/Builder");
const Dealer = require("../models/Dealer");

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
    const builder = await Builder.findById(property.builderId);
    if (builder) {
      builder.projectCount = Math.max(0, builder.projectCount - 1);
      await builder.save();
    }
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
      const builder = await Builder.findById(oldBuilderId);
      if (builder) {
        builder.projectCount = Math.max(0, builder.projectCount - 1);
        await builder.save();
      }
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

module.exports = { linkProperty, unlinkProperty, relinkProperty };
