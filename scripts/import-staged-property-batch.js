require("dotenv").config();
const mongoose = require("mongoose");
const { importStagedBatch, isTransientNetworkError, errorMessage } = require("../src/services/propertyBatchImporter");

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function directMongoUri(sourceUri, hosts, replicaSet) {
  const source = new URL(sourceUri);
  const query = new URLSearchParams(source.search);
  query.set("tls", "true");
  query.set("authSource", query.get("authSource") || "admin");
  query.set("replicaSet", replicaSet);
  query.set("serverSelectionTimeoutMS", "30000");
  query.delete("directConnection");
  const seeds = hosts.map((host) => `${host.trim()}:27017`).join(",");
  return `mongodb://${source.username}:${source.password}@${seeds}${source.pathname}?${query}`;
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const limitArg = args.find((value) => value.startsWith("--limit="));
  const onlyArg = args.find((value) => value.startsWith("--only="));
  const mongoHostsArg = args.find((value) => value.startsWith("--mongo-hosts="));
  const replicaSetArg = args.find((value) => value.startsWith("--replica-set="));
  const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1]) || 1) : Infinity;
  const only = onlyArg ? onlyArg.slice("--only=".length) : "";
  const mongoHosts = mongoHostsArg ? mongoHostsArg.slice("--mongo-hosts=".length).split(",").filter(Boolean) : [];
  const replicaSet = replicaSetArg ? replicaSetArg.slice("--replica-set=".length) : "";
  const summaryPath = args.find((value) => !value.startsWith("--"));
  if (!summaryPath) throw new Error("Usage: node scripts/import-staged-property-batch.js <summary.json> [--execute] [--limit=N] [--only=Project Name] [--mongo-hosts=host1,host2,host3 --replica-set=name]");
  if (execute && !process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured");
  if (mongoHosts.length && !replicaSet) throw new Error("--replica-set is required with --mongo-hosts");
  const mongoUri = mongoHosts.length ? directMongoUri(process.env.MONGODB_URI, mongoHosts, replicaSet) : process.env.MONGODB_URI;
  let result;
  let retry = 0;
  while (!result) {
    try {
      if (execute && mongoose.connection.readyState !== 1) await mongoose.connect(mongoUri);
      result = await importStagedBatch({
        summaryPath, execute, limit, only,
        onProgress: (row) => console.log(`[${row.index}/${row.total}] ${row.status.toUpperCase()} ${row.projectName}${row.error ? `: ${row.error}` : ` (${row.mediaCount || 0} media, ${row.documentCount || 0} documents)`}`),
      });
    } catch (error) {
      if (!execute || !isTransientNetworkError(error) || retry >= 50) throw error;
      retry += 1;
      console.warn(`[network retry ${retry}/50] ${error.message || error}. Reconnecting in 10 seconds...`);
      await mongoose.disconnect().catch(() => {});
      await wait(10_000);
    }
  }
  console.log(JSON.stringify(result, null, 2));
  if (execute) await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.stack || errorMessage(error));
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
