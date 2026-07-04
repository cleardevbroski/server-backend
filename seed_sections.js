const mongoose = require('mongoose');
const Property = require('./src/models/Property');
require('dotenv').config();

const properties = [
  {
    title: "Sanjeevini Aarna",
    subtitle: "Hoskote, Bangalore",
    price: "₹1.11 - 1.43 Cr",
    pricePerSqft: "₹8,500/sqft",
    configs: ["3 BHK Apartment"],
    area: "1450 sqft",
    possession: "Dec 2026",
    builder: "Sanjeevini Group",
    image: "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=600&q=80",
    badges: ["New Launch", "RERA"],
    description: "A premium luxury apartment complex located in Hoskote with modern amenities.",
    propertyType: "Apartment",
    bedrooms: 3,
    bathrooms: 3,
    parking: "1 Covered",
    furnishing: "Unfurnished",
    facing: "East",
    floor: "4th of 10 Floors",
    transactionType: "New Property",
    ageOfProperty: "Under Construction",
    reraRegistered: true,
    verified: true,
    websiteSection: "Newly Launched",
  },
  {
    title: "Prestige Lakeside Habitat",
    subtitle: "Varthur, Whitefield",
    price: "₹1.85 Cr",
    pricePerSqft: "₹11,500/sqft",
    configs: ["3 BHK", "4 BHK"],
    area: "1850 sqft",
    possession: "Ready to Move",
    builder: "Prestige Group",
    image: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=600&q=80",
    badges: ["Premium", "RERA"],
    description: "Luxury villas and apartments by Prestige Group overlooking the serene Varthur Lake.",
    propertyType: "Villa",
    bedrooms: 4,
    bathrooms: 4,
    parking: "2 Covered",
    furnishing: "Semi-Furnished",
    facing: "North-East",
    transactionType: "New Property",
    ageOfProperty: "0-1 Years",
    reraRegistered: true,
    verified: true,
    websiteSection: "Handpicked",
  },
  {
    title: "BSCPL Bollineni Nestor",
    subtitle: "Yelahanka, Bangalore",
    price: "₹50 - 75 L",
    configs: ["2 BHK", "3 BHK"],
    area: "1200 sqft",
    possession: "Ready to Move",
    builder: "BSCPL Infrastructure",
    image: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=600&q=80",
    badges: ["RERA"],
    description: "Affordable premium housing in North Bangalore.",
    propertyType: "Apartment",
    bedrooms: 2,
    bathrooms: 2,
    reraRegistered: true,
    verified: true,
    websiteSection: "Search Trends",
  },
  {
    title: "Peram Eco City",
    subtitle: "Hoskote, Bangalore",
    price: "₹2.49 Cr",
    configs: ["4 BHK Villa"],
    area: "2500 sqft",
    possession: "Mar 2027",
    builder: "Peram Group",
    image: "https://images.unsplash.com/photo-1576941089067-2de3c901e126?w=400&q=80",
    badges: ["Special Offer"],
    description: "Luxurious eco-friendly villas with special pre-EMI offers.",
    propertyType: "Villa",
    bedrooms: 4,
    bathrooms: 5,
    reraRegistered: true,
    verified: true,
    websiteSection: "Offers",
  }
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB.");

    // Remove old properties for these sections to avoid duplicates
    await Property.deleteMany({
      websiteSection: { $in: ["Handpicked", "Newly Launched", "Search Trends", "Offers"] }
    });
    console.log("Cleared old mock section properties.");

    await Property.insertMany(properties);
    console.log("Successfully seeded properties for homepage sections!");

    process.exit(0);
  } catch (error) {
    console.error("Error seeding data:", error);
    process.exit(1);
  }
}

seed();
