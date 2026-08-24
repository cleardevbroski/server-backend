const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongod;

beforeAll(async () => {
  // mongod can take >10s to boot on slower/contended machines; default launch timeout is 10s
  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 120000 } });
  await mongoose.connect(mongod.getUri());
}, 120000);

beforeEach(() => {
  // Tests opt in to provider calls explicitly. Never use a developer's or
  // deployment's real Resend credential for automated test recipients.
  delete process.env.RESEND_API_KEY;
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
