/**
 * Seed the gift catalog — 7 categories x 20 items (140 total), sourced from
 * the canonical GIFT_CATALOG_DATA (api/data/giftCatalogData.js).
 *
 * Run from the FUSE - BE root, AFTER uploadGiftImages.js has populated S3:
 *   node api/scripts/seedGiftCatalog.js
 *
 * Idempotent: upserts by `name` (re-running updates prices/images in place),
 * and deactivates any currently-active item that is no longer in the data
 * file (cleanly retires the old placeholder-image catalog instead of leaving
 * orphaned active items behind).
 *
 * Pricing rule per item: finalAmount = price + platformFee + deliveryFee.
 * Bands: LOW price <= 499, MID price 500..2999.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import GiftCatalogItem from "../models/GiftCatalogItem.js";
import { GIFT_CATALOG_DATA } from "../data/giftCatalogData.js";

// .env is at FUSE - BE root — run this script from that directory
dotenv.config();

const s3Bucket = process.env.AWS_S3_BUCKET;
const s3Region = process.env.AWS_REGION;

// Same public-URL pattern already used for profile photos — see
// ProfilePhotoController.js buildS3PublicUrl(). No signed URLs; the bucket
// already allows public GetObject for this pattern to work at all.
const encodeS3Key = (key) => key.split("/").map(encodeURIComponent).join("/");
const buildImageUrl = (filename) => {
  const key = encodeS3Key(`gifts/${filename}`);
  return `https://${s3Bucket}.s3.${s3Region}.amazonaws.com/${key}`;
};

const run = async () => {
  if (!process.env.MONGO_URI) {
    console.error("❌ MONGO_URI not set in .env");
    process.exit(1);
  }
  if (!s3Bucket || !s3Region) {
    console.error("❌ AWS_S3_BUCKET / AWS_REGION not set in .env");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Connected to MongoDB");

  let created = 0;
  let updated = 0;

  const seededNames = new Set();

  for (const raw of GIFT_CATALOG_DATA) {
    const { keyword, filename, ...itemFields } = raw;
    const data = { ...itemFields, imageUrl: buildImageUrl(filename) };
    seededNames.add(data.name);

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

  // Retire any previously-active item that is no longer in the data file
  // (e.g. the old 12-item placeholder catalog) instead of leaving it as a
  // stale purchasable item.
  const deactivateResult = await GiftCatalogItem.updateMany(
    { isActive: true, name: { $nin: Array.from(seededNames) } },
    { $set: { isActive: false } }
  );

  console.log(
    `\n🎁 Seed complete — ${created} created, ${updated} updated, ${deactivateResult.modifiedCount} retired (deactivated).`
  );
  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
