/**
 * Seed script: Curated local Chennai events for Fuse Explore.
 * Run: node api/scripts/seedEvents.js
 */
import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import Event from "../models/Event.js";

const now = new Date();
const daysFromNow = (d) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);

const EVENTS = [
  {
    title: "The Open Mic Night — Chennai Laughs",
    description:
      "Chennai's favourite weekly open mic for stand-up comedy, spoken word, and live music. Discover new voices, laugh out loud, and meet interesting people.",
    city: "Chennai",
    venue: "The Bflat Bar",
    address: "36, Khader Nawaz Khan Road, Nungambakkam, Chennai",
    category: "comedy",
    eventDate: daysFromNow(7),
    eventEndDate: daysFromNow(7),
    images: ["https://images.fusedating.co.in/events/open-mic.jpg"],
    tags: ["comedy", "open mic", "live music", "weekend"],
    ticketPrice: 399,
    originalPrice: 499,
    totalSlots: 60,
    soldSlots: 12,
    maxPerOrder: 4,
    isActive: true,
    isFeatured: true,
    sortOrder: 1,
    agePolicy: "18+",
    dressCode: "Smart casual",
  },
  {
    title: "Rooftop Sunset Social — Nungambakkam",
    description:
      "A curated social mixer on a breezy rooftop. Chill music, good drinks, and a relaxed vibe to meet new people in Chennai.",
    city: "Chennai",
    venue: "Bay 146 Rooftop",
    address: "146, Nungambakkam High Road, Chennai",
    category: "social",
    eventDate: daysFromNow(10),
    eventEndDate: daysFromNow(10),
    images: ["https://images.fusedating.co.in/events/rooftop-social.jpg"],
    tags: ["social", "rooftop", "sunset", "mixer"],
    ticketPrice: 599,
    originalPrice: 599,
    totalSlots: 40,
    soldSlots: 18,
    maxPerOrder: 2,
    isActive: true,
    isFeatured: true,
    sortOrder: 2,
    agePolicy: "21+",
    dressCode: "Smart casual",
  },
  {
    title: "Comedy Night ft. Local Headliners",
    description:
      "A full-length comedy show with Chennai's top stand-up comedians. One of the best nights out in the city.",
    city: "Chennai",
    venue: "Unwind Centre, Alwarpet",
    address: "9/2, 1st Avenue, Harrington Road, Chetpet, Chennai",
    category: "comedy",
    eventDate: daysFromNow(14),
    eventEndDate: daysFromNow(14),
    images: ["https://images.fusedating.co.in/events/comedy-night.jpg"],
    tags: ["comedy", "stand-up", "weekend", "live"],
    ticketPrice: 499,
    originalPrice: 599,
    totalSlots: 120,
    soldSlots: 45,
    maxPerOrder: 4,
    isActive: true,
    isFeatured: false,
    sortOrder: 3,
    agePolicy: "18+",
  },
  {
    title: "Indie Music Night — Local Bands",
    description:
      "Three Chennai indie bands performing original music. Perfect for music lovers looking for a meaningful night out.",
    city: "Chennai",
    venue: "The Bflat Bar",
    address: "36, Khader Nawaz Khan Road, Nungambakkam, Chennai",
    category: "music",
    eventDate: daysFromNow(17),
    eventEndDate: daysFromNow(17),
    images: ["https://images.fusedating.co.in/events/indie-music.jpg"],
    tags: ["indie", "live music", "bands", "weekend"],
    ticketPrice: 349,
    originalPrice: 349,
    totalSlots: 80,
    soldSlots: 22,
    maxPerOrder: 4,
    isActive: true,
    isFeatured: false,
    sortOrder: 4,
    agePolicy: "18+",
    dressCode: "Casual",
  },
  {
    title: "Sunday Brunch Party — Besant Nagar",
    description:
      "A lively Sunday brunch party with live DJ, good food, and a buzzing social vibe. Come solo or with a date.",
    city: "Chennai",
    venue: "Sea View Terrace",
    address: "Beach Road, Besant Nagar, Chennai",
    category: "party",
    eventDate: daysFromNow(21),
    eventEndDate: daysFromNow(21),
    images: ["https://images.fusedating.co.in/events/brunch-party.jpg"],
    tags: ["brunch", "party", "DJ", "beachside", "social"],
    ticketPrice: 799,
    originalPrice: 999,
    totalSlots: 50,
    soldSlots: 8,
    maxPerOrder: 6,
    isActive: true,
    isFeatured: true,
    sortOrder: 5,
    agePolicy: "21+",
    dressCode: "Smart casual",
  },
  {
    title: "Photography Walk — Fort St. George",
    description:
      "Guided heritage photography walk around Fort St. George. Meet fellow shutterbugs in a safe, interesting setting.",
    city: "Chennai",
    venue: "Fort St. George",
    address: "Fort St. George, Chennai",
    category: "workshop",
    eventDate: daysFromNow(24),
    eventEndDate: daysFromNow(24),
    images: ["https://images.fusedating.co.in/events/photo-walk.jpg"],
    tags: ["photography", "heritage", "walk", "social"],
    ticketPrice: 299,
    originalPrice: 299,
    totalSlots: 30,
    soldSlots: 5,
    maxPerOrder: 2,
    isActive: true,
    isFeatured: false,
    sortOrder: 6,
    agePolicy: "All ages",
    importantInfo: "Bring your own camera or phone. Comfortable shoes recommended.",
  },

  // ─── Iteration 2: aggregated free/external Meet People events ────────────────
  {
    title: "Sunrise Run Club — Marina Beach",
    description:
      "Weekly 5K sunrise run along Marina Beach with Chennai's friendliest running community. Free to join — Fuse members get a circle of who else from Fuse is running.",
    city: "Chennai",
    venue: "Marina Beach (Lighthouse end)",
    address: "Marina Beach, Chennai",
    category: "sports",
    audience: "MEET_PEOPLE",
    pricingType: "FREE_RSVP",
    eventDate: daysFromNow(5),
    eventEndDate: daysFromNow(5),
    images: ["https://images.fusedating.co.in/events/sunrise-run.jpg"],
    tags: ["running", "fitness", "morning", "free", "community"],
    rsvpCap: 40,
    isActive: true,
    isFeatured: true,
    sortOrder: 7,
    agePolicy: "18+",
    organizer: { name: "Chennai Sunrise Runners", instagram: "@chennaisunriserunners" },
    importantInfo: "Meet at the lighthouse end, 5:45 AM. Bring water and running shoes.",
  },
  {
    title: "Board Game Night — Ciclo Café",
    description:
      "A cozy weekly board game night at Ciclo Café. Entry ticketed by the café directly — Fuse users get a promo code and can see who else from Fuse is going.",
    city: "Chennai",
    venue: "Ciclo Café",
    address: "Besant Nagar, Chennai",
    category: "social",
    audience: "MEET_PEOPLE",
    pricingType: "PAID_EXTERNAL",
    externalBookingUrl: "https://ciclocafe.example.com/board-game-night",
    externalPrice: "₹300 onwards (entry + one drink)",
    promoCode: "FUSE10",
    eventDate: daysFromNow(8),
    eventEndDate: daysFromNow(8),
    images: ["https://images.fusedating.co.in/events/board-game-night.jpg"],
    tags: ["board games", "cafe", "social", "meetup"],
    rsvpCap: 25,
    isActive: true,
    isFeatured: true,
    sortOrder: 8,
    agePolicy: "18+",
    organizer: { name: "Ciclo Café", instagram: "@ciclocafechennai" },
    importantInfo: "Show the promo code at the counter for 10% off.",
  },
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB.");

  for (const e of EVENTS) {
    await Event.updateOne({ title: e.title, city: e.city }, { $set: e }, { upsert: true });
    console.log(`✓ ${e.title}`);
  }

  console.log(`\n✅ Seeded ${EVENTS.length} events.`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
