const mongoose = require('mongoose');
const Testimonial = require('./src/models/Testimonial');
const Lawyer = require('./src/models/Lawyer');
const Insight = require('./src/models/Insight');
const Property = require('./src/models/Property');
require('dotenv').config();

async function clear() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB.");

    // Clear CMS data
    const testimonialResult = await Testimonial.deleteMany({});
    const lawyerResult = await Lawyer.deleteMany({});
    const insightResult = await Insight.deleteMany({});
    console.log(`Cleared CMS data: ${testimonialResult.deletedCount} testimonials, ${lawyerResult.deletedCount} lawyers, ${insightResult.deletedCount} insights`);

    // Clear seeded section properties
    const propertyResult = await Property.deleteMany({
      websiteSection: { $in: ["Handpicked", "Newly Launched", "Search Trends", "Offers"] }
    });
    console.log(`Cleared ${propertyResult.deletedCount} seeded section properties.`);

    console.log("Successfully cleared all mock seeded data!");
    process.exit(0);
  } catch (error) {
    console.error("Error clearing data:", error);
    process.exit(1);
  }
}

clear();
