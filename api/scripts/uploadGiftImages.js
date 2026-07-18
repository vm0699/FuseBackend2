/**
 * Sources a product photo per gift catalog item from Pexels (CC0,
 * commercial-safe) and uploads it to S3 under the `gifts/` prefix, matching
 * the same public-URL pattern already used for profile photos
 * (see ProfilePhotoController.js — plain https://<bucket>.s3.<region>.amazonaws.com/<key>,
 * no signed URLs).
 *
 * Run from the FUSE - BE root, BEFORE seedGiftCatalog.js:
 *   node api/scripts/uploadGiftImages.js
 *
 * Idempotent/resumable: skips any filename that already exists in S3, so a
 * failed/interrupted run can just be re-run.
 *
 * Requires in .env: PEXELS_API_KEY, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
 * AWS_REGION, AWS_S3_BUCKET.
 */
import dotenv from "dotenv";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { GIFT_CATALOG_DATA } from "../data/giftCatalogData.js";

dotenv.config();

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const s3Bucket = process.env.AWS_S3_BUCKET;
const s3Region = process.env.AWS_REGION;

if (!PEXELS_API_KEY) {
  console.error("❌ PEXELS_API_KEY not set in .env");
  process.exit(1);
}
if (!s3Bucket || !s3Region) {
  console.error("❌ AWS_S3_BUCKET / AWS_REGION not set in .env");
  process.exit(1);
}

const s3 = new S3Client({
  region: s3Region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const objectExists = async (key) => {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: s3Bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
};

const searchPexels = async (keyword) => {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(
    keyword
  )}&per_page=1`;
  const res = await fetch(url, {
    headers: { Authorization: PEXELS_API_KEY },
  });
  if (!res.ok) {
    throw new Error(`Pexels search failed (${res.status}) for "${keyword}"`);
  }
  const data = await res.json();
  const photo = data?.photos?.[0];
  if (!photo?.src?.large) {
    throw new Error(`No Pexels result for "${keyword}"`);
  }
  return photo.src.large;
};

const uploadToS3 = async (key, imageUrl) => {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    throw new Error(`Failed to download image (${imgRes.status})`);
  }
  const buffer = Buffer.from(await imgRes.arrayBuffer());

  await s3.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
    })
  );
};

const run = async () => {
  console.log(`🖼️  Sourcing ${GIFT_CATALOG_DATA.length} gift images via Pexels → S3 (${s3Bucket}/gifts/)\n`);

  let uploaded = 0;
  let skipped = 0;
  const failed = [];

  for (const item of GIFT_CATALOG_DATA) {
    const key = `gifts/${item.filename}`;

    try {
      if (await objectExists(key)) {
        console.log(`↷ Skipped (already in S3): ${item.filename}`);
        skipped += 1;
        continue;
      }

      const imageUrl = await searchPexels(item.keyword);
      await uploadToS3(key, imageUrl);
      console.log(`✔ Uploaded: ${item.filename}  (keyword: "${item.keyword}")`);
      uploaded += 1;

      // Be polite to Pexels' rate limit (200 req/hr on free tier — 140 items
      // is well under that, but a small delay avoids any burst throttling).
      await sleep(350);
    } catch (err) {
      console.error(`✘ Failed: ${item.filename} — ${err.message}`);
      failed.push({ name: item.name, filename: item.filename, keyword: item.keyword, error: err.message });
    }
  }

  console.log(`\n🎁 Done — ${uploaded} uploaded, ${skipped} already present, ${failed.length} failed.`);
  if (failed.length) {
    console.log("\nFailed items (re-run this script to retry — it skips what's already uploaded):");
    for (const f of failed) {
      console.log(`  - ${f.name} (${f.filename}) — ${f.error}`);
    }
  }
};

run().catch((err) => {
  console.error("❌ uploadGiftImages failed:", err);
  process.exit(1);
});
