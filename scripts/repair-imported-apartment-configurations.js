require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Property = require("../src/models/Property");
const { parsePropertyTemplate } = require("../src/services/propertyTemplateParser");

function clean(value) { return String(value ?? "").trim(); }

function numericDisplay(value, field = "area") {
  const match = clean(value).replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) return Number.NaN;
  const amount = Number(match[0]);
  if (field !== "price") return amount;
  const unit = clean(value).toLowerCase();
  if (/\b(?:cr|crore)\b/.test(unit)) return amount * 10_000_000;
  if (/\b(?:l|lac|lakh)\b/.test(unit)) return amount * 100_000;
  return amount;
}

function displayRange(rows, fields, fieldType = "area") {
  const values = rows.flatMap((row) => {
    const display = fields.map((field) => clean(row[field])).find(Boolean) || "";
    const numeric = numericDisplay(display, fieldType);
    return Number.isFinite(numeric) ? [{ display, numeric }] : [];
  }).sort((left, right) => left.numeric - right.numeric);
  if (!values.length) return "";
  return values[0].numeric === values.at(-1).numeric ? values[0].display : `${values[0].display} - ${values.at(-1).display}`;
}

function mergeRows(parsedRows, currentRows) {
  const used = new Set();
  return parsedRows.map((parsed) => {
    const parsedArea = numericDisplay(parsed.builtUpArea || parsed.superBuiltUpArea || parsed.carpetArea);
    let index = currentRows.findIndex((current, candidateIndex) => !used.has(candidateIndex)
      && clean(current.configuration).toLowerCase() === clean(parsed.configuration).toLowerCase()
      && numericDisplay(current.builtUpArea || current.superBuiltUpArea || current.carpetArea) === parsedArea);
    if (index < 0) index = currentRows.findIndex((current, candidateIndex) => !used.has(candidateIndex) && clean(current.configuration).toLowerCase() === clean(parsed.configuration).toLowerCase());
    if (index >= 0) used.add(index);
    const current = index >= 0 ? currentRows[index] : {};
    return {
      ...current,
      configuration: parsed.configuration,
      price: clean(parsed.price) || clean(current.price),
      superBuiltUpArea: clean(parsed.superBuiltUpArea) || clean(current.superBuiltUpArea),
      builtUpArea: clean(parsed.builtUpArea) || clean(current.builtUpArea),
      carpetArea: clean(parsed.carpetArea) || clean(current.carpetArea),
      bedrooms: parsed.bedrooms ?? current.bedrooms,
      bathrooms: parsed.bathrooms ?? current.bathrooms,
      balconies: parsed.balconies ?? current.balconies,
      facings: parsed.facings?.length ? parsed.facings : current.facings || [],
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const onlyArg = args.find((value) => value.startsWith("--only="));
  const summaryArg = args.find((value) => !value.startsWith("--"));
  if (!summaryArg) throw new Error("Usage: node scripts/repair-imported-apartment-configurations.js <summary.json> [--only=Project Name] [--execute]");
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not configured");

  const summaryPath = path.resolve(summaryArg);
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const reviewFolder = path.dirname(summaryPath);
  const only = clean(onlyArg ? onlyArg.slice("--only=".length) : "").toLowerCase();
  const records = (summary.records || []).filter((record) => !only || [record.projectName, record.packageName].some((value) => clean(value).toLowerCase() === only));
  if (only && !records.length) throw new Error(`No staged package matches: ${onlyArg.slice("--only=".length)}`);

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30_000 });
  const report = [];
  for (const record of records) {
    const staged = JSON.parse(fs.readFileSync(path.join(reviewFolder, record.reviewFile), "utf8"));
    const parsed = parsePropertyTemplate(staged).payload;
    if (parsed.propertyType !== "Apartment" || !parsed.configurationDetails?.length) continue;
    const property = await Property.findOne({ "bulkImport.packageKey": staged.package.packageKey });
    if (!property) { report.push({ projectName: record.projectName, status: "not_found" }); continue; }
    const currentRows = property.configurationDetails?.toObject?.() || property.configurationDetails || [];
    const nextRows = mergeRows(parsed.configurationDetails, currentRows);
    const changed = JSON.stringify(nextRows) !== JSON.stringify(currentRows);
    if (execute && changed) {
      property.configurationDetails = nextRows;
      property.configs = nextRows.map((row) => row.configuration);
      property.price = displayRange(nextRows, ["price"], "price") || property.price;
      property.area = displayRange(nextRows, ["builtUpArea", "superBuiltUpArea", "carpetArea"]) || property.area;
      await property.save();
    }
    report.push({ projectName: record.projectName, status: changed ? execute ? "updated" : "would_update" : "unchanged", before: currentRows.length, after: nextRows.length });
  }
  await mongoose.disconnect();
  const counts = report.reduce((result, row) => ({ ...result, [row.status]: (result[row.status] || 0) + 1 }), {});
  console.log(JSON.stringify({ mode: execute ? "execute" : "preview", selected: records.length, counts, records: report }, null, 2));
}

main().catch(async (error) => {
  console.error(error.stack || error.message || error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
