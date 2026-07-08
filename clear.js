const mongoose = require('mongoose');
const Testimonial = require('./src/models/Testimonial');
const Lawyer = require('./src/models/Lawyer');
const Insight = require('./src/models/Insight');
const Property = require('./src/models/Property');
require('dotenv').config();

async function clear() {
  if (!process.argv.includes('--confirm')) {
    console.error(
      'This deletes ALL Testimonial, Lawyer, and Insight rows, plus any ' +
      'Property tagged into Handpicked/Newly Launched/Search Trends/Offers — ' +
      'including real admin-entered data, not just seed data.\n' +
      'Re-run with --confirm to proceed: npm run db:clear -- --confirm'
    );
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB.");

    const testimonialResult = await Testimonial.deleteMany({});
    const lawyerResult = await Lawyer.deleteMany({});
    const insightResult = await Insight.deleteMany({});
    console.log(`Cleared CMS data: ${testimonialResult.deletedCount} testimonials, ${lawyerResult.deletedCount} lawyers, ${insightResult.deletedCount} insights`);

    const propertyResult = await Property.deleteMany({
      websiteSection: { $in: ["Handpicked", "Newly Launched", "Search Trends", "Offers"] }
    });
    console.log(`Cleared ${propertyResult.deletedCount} section-tagged properties.`);

    console.log("Done.");
    process.exit(0);
  } catch (error) {
    console.error("Error clearing data:", error);
    process.exit(1);
  }
}

clear();
