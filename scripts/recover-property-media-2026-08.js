// One-time guarded recovery for the August 2026 detached property media incident.
// Run without arguments to inspect. Pass --apply to restore only empty records.
require("dotenv").config();
const mongoose = require("mongoose");
const Property = require("../src/models/Property");

const recovery = {
  "Prestige Group": {
    heroImages: ["aorscsucubdjbbgwtjkd", "e4dfk1n7qrmpakrmesbg", "nrcuevducfg2awvaa4lk"],
    images: ["i0phj7ffgbo94r03cey9", "hsgua31elnxik4ceyf1b", "oppdrzrunudrzv7axzxi", "rdiqkz4njabqu27gi7vd", "dqcw6vrbpgvahymwnsx1"],
    developerLogoUrl: "h2jyrkwbanjgqjedscny",
  },
  "Century Jakkur (Century Immencity Residential)": {
    heroImages: ["bicvgmeaytry7p3guf1c", "bt1gwtbf1xcagk3o4372", "czanaeswrjd3mzbhewgb"],
    images: ["ceo2gjblyammuf7ek5fw", "co2jo4sswih6neipuqwi", "fybyp7pydppmceskwllu", "hidyhbntz8bnoibj7jyh", "iyblkb0qtbys1ocacb6w", "ls3e6niwo0wr0sjwaom9", "qz5hualwjlcou3djqpov", "rm1nyvffzwooo7frvbzh", "yjfvlaw4gxiwvnrjojw5"],
    developerLogoUrl: "syb95w7ilj2tg8ce2zi5",
    localityMapImageUrl: "xi9mjdaeg5qm6eyrhaft",
  },
};

const imageUrl = (id) => `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/clear-title/properties/${id}.jpg`;

function cloudinaryUrls(value, out = []) {
  if (typeof value === "string" && value.includes("res.cloudinary.com")) out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => cloudinaryUrls(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => cloudinaryUrls(item, out));
  return out;
}

function fieldsFor(data) {
  return {
    heroImages: data.heroImages.map(imageUrl),
    images: data.images.map(imageUrl),
    developerLogoUrl: imageUrl(data.developerLogoUrl),
    ...(data.localityMapImageUrl ? { localityMapImageUrl: imageUrl(data.localityMapImageUrl) } : {}),
  };
}

async function main() {
  if (!process.env.MONGODB_URI || !process.env.CLOUDINARY_CLOUD_NAME) throw new Error("MongoDB and Cloudinary configuration are required");
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const apply = process.argv.includes("--apply");
  const current = await Property.find({ title: { $in: Object.keys(recovery) } }).lean();
  if (current.length !== Object.keys(recovery).length) throw new Error("One or more recovery properties are missing");

  if (apply) {
    const session = await mongoose.startSession();
    await session.withTransaction(async () => {
      for (const property of current) {
        if ((property.heroImages || []).length || (property.images || []).length) continue;
        const fields = fieldsFor(recovery[property.title]);
        const mediaAssets = [...new Set([...cloudinaryUrls(property), ...cloudinaryUrls(fields)])];
        const result = await Property.updateOne(
          {
            _id: property._id,
            $and: [
              { $or: [{ heroImages: { $size: 0 } }, { heroImages: { $exists: false } }] },
              { $or: [{ images: { $size: 0 } }, { images: { $exists: false } }] },
            ],
          },
          { $set: { ...fields, mediaAssets } },
          { session }
        );
        if (result.modifiedCount !== 1) throw new Error(`${property.title} changed during recovery`);
      }
    });
    await session.endSession();
  }

  const result = await Property.find({ title: { $in: Object.keys(recovery) } })
    .select("title heroImages images developerLogoUrl localityMapImageUrl mediaAssets")
    .lean();
  for (const property of result) {
    console.log(JSON.stringify({
      title: property.title,
      hero: (property.heroImages || []).length,
      gallery: (property.images || []).length,
      logo: Boolean(property.developerLogoUrl),
      map: Boolean(property.localityMapImageUrl),
      ledger: (property.mediaAssets || []).length,
    }));
  }
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(`${error.name}: ${error.message}`);
  process.exit(1);
});
