require("dotenv").config();
const mongoose = require("mongoose");
const CPProspect = require("../src/models/CPProspect");

function spreadsheetReader() {
  try { return require("xlsx"); } catch {
    // The frontend owns the workbook reader; this fallback keeps the one-time script dependency-free.
    return require("../../public-frontend/node_modules/xlsx");
  }
}

const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
function normalizeMobile(value) {
  let mobile = String(value ?? "").replace(/\D/g, "");
  if (mobile.length === 12 && mobile.startsWith("91")) mobile = mobile.slice(2);
  if (mobile.length === 11 && mobile.startsWith("0")) mobile = mobile.slice(1);
  return /^[6-9]\d{9}$/.test(mobile) ? mobile : "";
}

function rowsFromWorkbook(filePath) {
  const XLSX = spreadsheetReader();
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const records = new Map();
  const groups = new Map();
  let allocationSequence = 0;
  let duplicateSourceMobiles = 0;

  for (const sourceGroup of workbook.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sourceGroup], { header: 1, defval: "", raw: false });
    const headers = matrix[0] || [];
    const mobileColumn = headers.findIndex((header) => ["phone", "mobile", "mobilenumber"].includes(normalize(header)));
    const serialColumn = headers.findIndex((header) => normalize(header) === "slno");
    if (mobileColumn < 0 || serialColumn < 0) throw new Error(`${sourceGroup} must contain Phone and Sl.No columns.`);

    let groupCount = 0;
    matrix.slice(1).forEach((row) => {
      const mobile = normalizeMobile(row[mobileColumn]);
      const sourceSerialNumber = Number(String(row[serialColumn] ?? "").replace(/\D/g, ""));
      if (!mobile || !Number.isSafeInteger(sourceSerialNumber) || sourceSerialNumber < 1) return;
      allocationSequence += 1;
      groupCount += 1;
      if (records.has(mobile)) { duplicateSourceMobiles += 1; return; }
      records.set(mobile, { sourceGroup, sourceSerialNumber, allocationSequence });
    });
    groups.set(sourceGroup, groupCount);
  }
  return { records, groups, duplicateSourceMobiles };
}

async function main() {
  const [filePath] = process.argv.slice(2).filter((value) => value !== "--apply");
  const apply = process.argv.includes("--apply");
  if (!filePath) throw new Error("Usage: npm run db:backfill-cp-source-groups -- /path/to/Agents_Zone_Wise.xlsx [--apply]");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured");

  const { records, groups, duplicateSourceMobiles } = rowsFromWorkbook(filePath);
  await mongoose.connect(process.env.MONGODB_URI);
  const prospects = await CPProspect.find({ prospectType: "channel_partner", "contact.mobile": { $in: [...records.keys()] } })
    .select("contact.mobile sourceGroup sourceSerialNumber allocationSequence")
    .lean();

  const updates = prospects.flatMap((prospect) => {
    const source = records.get(prospect.contact.mobile);
    if (!source || (prospect.sourceGroup === source.sourceGroup && prospect.sourceSerialNumber === source.sourceSerialNumber && prospect.allocationSequence === source.allocationSequence)) return [];
    return [{ updateOne: { filter: { _id: prospect._id }, update: { $set: source } } }];
  });
  const matchedMobiles = new Set(prospects.map((prospect) => prospect.contact.mobile));
  const unmatchedSpreadsheet = [...records.keys()].filter((mobile) => !matchedMobiles.has(mobile)).length;

  console.log(`Workbook groups: ${[...groups.entries()].map(([name, count]) => `${name} (${count})`).join(", ")}`);
  console.log(`Workbook contacts: ${records.size}; duplicate workbook mobiles skipped: ${duplicateSourceMobiles}`);
  console.log(`Existing CP contacts matched: ${prospects.length}; changes required: ${updates.length}; workbook contacts not already imported: ${unmatchedSpreadsheet}`);
  if (!apply) {
    console.log("Dry run only. Run again with --apply to update existing contacts.");
    return;
  }
  if (updates.length) await CPProspect.bulkWrite(updates, { ordered: false });
  console.log(`Updated ${updates.length} existing CP contact(s). No contacts were created or deleted.`);
}

main()
  .catch((error) => { console.error("CP source-group backfill failed:", error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
