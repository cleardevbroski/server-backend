const mongoose = require('mongoose');
const Testimonial = require('./src/models/Testimonial');
const Lawyer = require('./src/models/Lawyer');
const Insight = require('./src/models/Insight');
require('dotenv').config();

const testimonials = [
  {
    name: "Srikanth Malleboina",
    role: "Buyer • Hyderabad",
    quote: "I found my dream home through cleartitleone. The verified listings saved me weeks of effort and I closed the deal in under a month.",
    rating: 5,
  }
];

const lawyers = [
  {
    name: "Adv. R. Srinivasan",
    experience: "18+ Yrs Exp",
    barCouncil: "KA/1902/2008",
    rating: 4.9,
    cases: "240+ Deeds Audited",
    specialty: "Land Title Verification",
    image: "https://images.unsplash.com/photo-1556157382-97eda2d62296?w=200&q=80",
  }
];

const insights = [
  {
    name: "Whitefield",
    rating: 4.3,
    pricePerSqft: "₹14,050/ sqft",
    yoy: "17.6% YoY",
    image: "https://images.unsplash.com/photo-1494526585095-c41746248156?w=400&q=80",
    href: "/property-in-whitefield-bangalore-ffid",
  }
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB.");

    await Testimonial.deleteMany({});
    await Lawyer.deleteMany({});
    await Insight.deleteMany({});
    console.log("Cleared old CMS data.");

    await Testimonial.insertMany(testimonials);
    await Lawyer.insertMany(lawyers);
    await Insight.insertMany(insights);
    console.log("Successfully seeded CMS data (Testimonial, Lawyer, Insight)!");

    process.exit(0);
  } catch (error) {
    console.error("Error seeding CMS data:", error);
    process.exit(1);
  }
}

seed();
