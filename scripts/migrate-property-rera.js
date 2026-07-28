require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const Property = require("../src/models/Property");
const Dealer = require("../src/models/Dealer");

async function migrate() {
  await connectDB();

  const legacyRera = await Property.find({
    reraRegistered: true,
    reraNumber: { $type: "string", $ne: "" },
    $or: [{ reraPhases: { $exists: false } }, { reraPhases: { $size: 0 } }],
  }).select("_id reraNumber");

  for (const property of legacyRera) {
    await Property.updateOne(
      { _id: property._id },
      {
        $set: {
          reraPhases: [{
            name: "Phase 1",
            reraNumber: property.reraNumber,
            reraSiteUrl: "",
            panNumber: "",
            order: 0,
            reraDocuments: [],
            projectDocuments: [],
          }],
        },
      }
    );
  }

  const cleanup = await Property.updateMany(
    {},
    {
      $unset: {
        maintenanceCharges: "",
        maintenancePeriod: "",
        "rentDetails.maintenanceMode": "",
        "rentDetails.maintenanceAmount": "",
        "leaseDetails.camCharges": "",
        dealerId: "",
      },
    }
  );
  await Dealer.updateMany({}, { $set: { propertyIds: [] } });
  await Property.collection.dropIndex("dealerId_1").catch((error) => {
    if (error.codeName !== "IndexNotFound") throw error;
  });

  console.log(`Migrated ${legacyRera.length} legacy RERA properties and cleaned ${cleanup.modifiedCount} properties.`);
}

migrate()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error(error);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
