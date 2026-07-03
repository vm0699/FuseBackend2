/**
 * Seed the gift catalog with realistic, Blinkit-style LOW/MID gift items.
 *
 * Run from the FUSE - BE root:
 *   node api/scripts/seedGiftCatalog.js
 *
 * Idempotent: upserts by `name`. Re-running updates prices/images in place.
 * Image URLs are placeholders — replace with final hosted/CDN assets later.
 *
 * Pricing rule per item: finalAmount = price + platformFee + deliveryFee.
 * Bands: LOW price <= 499, MID price 500..2999.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import GiftCatalogItem from "../models/GiftCatalogItem.js";

// .env is at FUSE - BE root — run this script from that directory
dotenv.config();

const img = (slug) =>
  `https://images.fusedating.co.in/gifts/${slug}.jpg`; // placeholder CDN path

const items = [
  // ---------------- LOW (<= 499) ----------------
  {
    name: "Dairy Milk Silk",
    description: "Cadbury Dairy Milk Silk, 150g — smooth, classic chocolate.",
    tier: "LOW",
    imageUrl: img("dairy-milk-silk"),
    price: 175,
    platformFee: 25,
    deliveryFee: 49,
    finalAmount: 249,
    category: "Chocolates",
    occasion: "JUST_BECAUSE",
    interestTags: ["chocolate", "sweets", "dessert", "foodie"],
    sortOrder: 10,
  },
  {
    name: "Single Red Rose",
    description: "A single fresh red rose, neatly wrapped.",
    tier: "LOW",
    imageUrl: img("single-red-rose"),
    price: 120,
    platformFee: 30,
    deliveryFee: 49,
    finalAmount: 199,
    category: "Flowers",
    occasion: "FIRST_DATE",
    interestTags: ["flowers", "romance", "nature"],
    sortOrder: 20,
  },
  {
    name: "Ferrero Rocher (4 pcs)",
    description: "Ferrero Rocher hazelnut chocolates, pack of 4.",
    tier: "LOW",
    imageUrl: img("ferrero-rocher-4"),
    price: 199,
    platformFee: 30,
    deliveryFee: 49,
    finalAmount: 278,
    category: "Chocolates",
    occasion: "CELEBRATION",
    interestTags: ["chocolate", "sweets", "foodie"],
    sortOrder: 30,
  },
  {
    name: "Scented Tealight Candles (Set of 6)",
    description: "Aromatic tealight candles for a cozy evening.",
    tier: "LOW",
    imageUrl: img("scented-tealights"),
    price: 249,
    platformFee: 50,
    deliveryFee: 49,
    finalAmount: 348,
    category: "Home & Decor",
    occasion: "JUST_BECAUSE",
    interestTags: ["home", "selfcare", "wellness", "aromatherapy"],
    sortOrder: 40,
  },
  {
    name: "Premium Ceramic Coffee Mug",
    description: "Minimalist matte ceramic mug, 350ml.",
    tier: "LOW",
    imageUrl: img("ceramic-mug"),
    price: 299,
    platformFee: 50,
    deliveryFee: 49,
    finalAmount: 398,
    category: "Drinkware",
    occasion: "THANK_YOU",
    interestTags: ["coffee", "tea", "home", "foodie"],
    sortOrder: 50,
  },
  {
    name: "Assorted Cookies Tin",
    description: "Butter and choco-chip cookies in a gift tin.",
    tier: "LOW",
    imageUrl: img("cookies-tin"),
    price: 349,
    platformFee: 50,
    deliveryFee: 49,
    finalAmount: 448,
    category: "Snacks",
    occasion: "JUST_BECAUSE",
    interestTags: ["snacks", "baking", "foodie", "sweets"],
    sortOrder: 60,
  },

  // ---------------- MID (500..2999) ----------------
  {
    name: "Money Plant in Ceramic Pot",
    description: "Live money plant in a designer ceramic pot.",
    tier: "MID",
    imageUrl: img("money-plant"),
    price: 549,
    platformFee: 100,
    deliveryFee: 49,
    finalAmount: 698,
    category: "Plants",
    occasion: "JUST_BECAUSE",
    interestTags: ["plants", "gardening", "nature", "home"],
    sortOrder: 70,
  },
  {
    name: "Mixed Roses Bouquet (10 stems)",
    description: "A hand-tied bouquet of ten fresh mixed roses.",
    tier: "MID",
    imageUrl: img("roses-bouquet"),
    price: 699,
    platformFee: 150,
    deliveryFee: 49,
    finalAmount: 898,
    category: "Flowers",
    occasion: "CELEBRATION",
    interestTags: ["flowers", "romance", "nature"],
    sortOrder: 80,
  },
  {
    name: "Chocolate Gift Hamper",
    description: "Curated hamper of assorted premium chocolates.",
    tier: "MID",
    imageUrl: img("chocolate-hamper"),
    price: 999,
    platformFee: 200,
    deliveryFee: 49,
    finalAmount: 1248,
    category: "Hampers",
    occasion: "CELEBRATION",
    interestTags: ["chocolate", "sweets", "foodie", "dessert"],
    sortOrder: 90,
  },
  {
    name: "Soft Teddy Bear (Medium)",
    description: "Huggable plush teddy bear, ~40cm.",
    tier: "MID",
    imageUrl: img("teddy-bear"),
    price: 799,
    platformFee: 150,
    deliveryFee: 49,
    finalAmount: 998,
    category: "Soft Toys",
    occasion: "FIRST_DATE",
    interestTags: ["cute", "romance", "comfort"],
    sortOrder: 100,
  },
  {
    name: "Scented Candle & Care Gift Box",
    description: "Luxury scented candle with a self-care mini set.",
    tier: "MID",
    imageUrl: img("selfcare-box"),
    price: 1199,
    platformFee: 250,
    deliveryFee: 49,
    finalAmount: 1498,
    category: "Self Care",
    occasion: "APOLOGY",
    interestTags: ["selfcare", "wellness", "aromatherapy", "skincare"],
    sortOrder: 110,
  },
  {
    name: "Birthday Cake (500g)",
    description: "Freshly baked chocolate truffle cake, 500g.",
    tier: "MID",
    imageUrl: img("birthday-cake"),
    price: 649,
    platformFee: 150,
    deliveryFee: 49,
    finalAmount: 848,
    category: "Cakes",
    occasion: "CELEBRATION",
    interestTags: ["cake", "dessert", "sweets", "baking", "foodie"],
    sortOrder: 120,
  },
];

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error("❌ MONGO_URI not set in .env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected to MongoDB");

  let created = 0;
  let updated = 0;

  for (const data of items) {
    const existing = await GiftCatalogItem.findOne({ name: data.name });
    if (existing) {
      Object.assign(existing, data, { isActive: true });
      await existing.save();
      updated += 1;
      console.log(`↻ Updated: ${data.name}`);
    } else {
      await GiftCatalogItem.create({ ...data, isActive: true });
      created += 1;
      console.log(`＋ Created: ${data.name}`);
    }
  }

  console.log(`\n🎁 Seed complete — ${created} created, ${updated} updated.`);
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
