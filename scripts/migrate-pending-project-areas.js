require("dotenv").config();

const mongoose = require("mongoose");
const connectDB = require("../src/config/db");
const { migratePendingProjectAreaUnits } = require("../src/services/pendingProjectAreaMigration");

async function migrate() {
  await connectDB();
  const result = await migratePendingProjectAreaUnits();
  console.log(JSON.stringify(result, null, 2));
}

migrate()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error(error);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
