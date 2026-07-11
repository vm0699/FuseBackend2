import UserProfile from '../models/UserProfile.js';
import Like from '../models/Like.js';
import Chat from '../models/ChatModel.js';
import Block from "../models/Block.js";
import SwipeRecord from '../models/SwipeRecord.js';
import EventRsvp from '../models/EventRsvp.js';
import { getCachedDeck, setCachedDeck } from '../services/discoveryDeckCache.js';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import client from "../config/twilio.js";
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';

function normalizeUsernameInput(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

const s3ClientConfig = {
  region: process.env.AWS_REGION,
};

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  s3ClientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const s3 = new S3Client(s3ClientConfig);
const s3Bucket = process.env.AWS_S3_BUCKET;
const s3PublicBaseUrl = process.env.AWS_S3_PUBLIC_BASE_URL;

const ensureS3UploadConfig = () => {
  const missing = [];

  if (!process.env.AWS_REGION) missing.push("AWS_REGION");
  if (!s3Bucket) missing.push("AWS_S3_BUCKET");

  if (missing.length > 0) {
    throw new Error(
      `Missing required S3 configuration: ${missing.join(", ")}`
    );
  }
};

const getUploadExtension = (file) => {
  const originalExtension = path.extname(file?.originalname || "").toLowerCase();
  if (originalExtension) return originalExtension;

  const byMimeType = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
  };

  return byMimeType[file?.mimetype] || "";
};

const buildS3ObjectKey = (file, userId) => {
  const extension = getUploadExtension(file);
  const rawName = path.basename(file?.originalname || "upload", extension);
  const safeName =
    rawName.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/-+/g, "-").slice(0, 60) ||
    "upload";

  return `profile-photos/${userId}/${Date.now()}-${safeName}${extension}`;
};

const encodeS3Key = (key) => key.split("/").map(encodeURIComponent).join("/");

const buildS3PublicUrl = (key) => {
  const encodedKey = encodeS3Key(key);

  if (s3PublicBaseUrl) {
    return `${s3PublicBaseUrl.replace(/\/+$/, "")}/${encodedKey}`;
  }

  return `https://${s3Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${encodedKey}`;
};

const uploadPhotoToS3 = async (file, userId) => {
  ensureS3UploadConfig();

  if (!file?.buffer) {
    throw new Error("Uploaded file buffer missing.");
  }

  const key = buildS3ObjectKey(file, userId);

  await s3.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );

  return {
    key,
    url: buildS3PublicUrl(key),
  };
};

const deleteLocalUploadIfPresent = (fileUrl, contextLabel = "photoCleanup") => {
  if (typeof fileUrl !== "string" || !fileUrl.includes("/uploads/")) {
    return;
  }

  const filename = fileUrl.split("/uploads/")[1];
  if (!filename) {
    return;
  }

  const decodedFilename = decodeURIComponent(filename.split("?")[0]);
  const filePath = path.resolve("uploads", decodedFilename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`🗑 [${contextLabel}] Deleted local upload:`, filePath);
  }
};

const extractS3KeyFromUrl = (fileUrl) => {
  if (typeof fileUrl !== "string" || fileUrl.trim().length === 0) {
    return null;
  }

  if (s3PublicBaseUrl) {
    const normalizedBase = s3PublicBaseUrl.replace(/\/+$/, "");
    if (fileUrl.startsWith(`${normalizedBase}/`)) {
      return decodeURIComponent(
        fileUrl.slice(normalizedBase.length + 1).split(/[?#]/)[0]
      );
    }
  }

  try {
    const parsed = new URL(fileUrl);
    const pathname = parsed.pathname.replace(/^\/+/, "");

    if (!pathname) {
      return null;
    }

    if (s3Bucket && parsed.hostname === `${s3Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com`) {
      return decodeURIComponent(pathname);
    }

    if (s3Bucket && parsed.hostname === `${s3Bucket}.s3.amazonaws.com`) {
      return decodeURIComponent(pathname);
    }

    if (
      s3Bucket &&
      parsed.hostname.includes("amazonaws.com") &&
      pathname.startsWith(`${s3Bucket}/`)
    ) {
      return decodeURIComponent(pathname.slice(s3Bucket.length + 1));
    }
  } catch {
    return null;
  }

  return null;
};

const deleteStoredPhotoIfPresent = async (
  fileUrl,
  contextLabel = "photoCleanup"
) => {
  const s3Key = extractS3KeyFromUrl(fileUrl);

  if (s3Key) {
    ensureS3UploadConfig();
    await s3.send(
      new DeleteObjectCommand({
        Bucket: s3Bucket,
        Key: s3Key,
      })
    );
    console.log(`🗑 [${contextLabel}] Deleted S3 object:`, s3Key);
    return;
  }

  deleteLocalUploadIfPresent(fileUrl, contextLabel);
};

const deleteStoredPhotos = async (photoUrls, contextLabel) => {
  const results = await Promise.allSettled(
    (photoUrls || []).map((photoUrl) =>
      deleteStoredPhotoIfPresent(photoUrl, contextLabel)
    )
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(
        `🔥 [${contextLabel}] Failed to delete photo:`,
        photoUrls[index],
        result.reason
      );
    }
  });
};

// Save or Update User Profile
export const saveUserProfile = async (req, res) => {
  console.log("📥 [saveUserProfile] Incoming body:", req.body);
  console.log("🔑 [saveUserProfile] Auth user:", req.user);

  try {
    const { intro, options, profileDetails, prompts, photos } = req.body;

    const userId = req.user?.id;
    const phoneFromToken = req.user?.phoneNumber;

    if (!userId || !phoneFromToken) {
      console.log("❌ Missing user ID or phone in token");
      return res.status(401).json({
        success: false,
        message: "Unauthorized: missing user in token",
      });
    }

    console.log("🟢 Using authenticated user:", userId, phoneFromToken);

    let existingUser = await UserProfile.findById(userId);

    if (!existingUser) {
      console.log("⚠️ User not found by ID. Trying phoneNumber lookup…");
      existingUser = await UserProfile.findOne({ phoneNumber: phoneFromToken });
    }

    if (!existingUser) {
      console.log("❌ User not found in database at all.");
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    console.log("🟢 User found:", existingUser._id.toString());

// 📝 Save onboarding fields (SAFE MERGE — DO NOT WIPE EXISTING DATA)

// intro
if (intro?.name) existingUser.name = intro.name;
if (intro?.dob) existingUser.dateOfBirth = intro.dob;

// options
if (typeof options?.username !== "undefined") {
  const normalizedUsername = normalizeUsernameInput(options.username);
  if (normalizedUsername) {
    existingUser.username = normalizedUsername;
  }
}
if (options?.gender) existingUser.gender = options.gender;

// profileDetails
if (profileDetails?.height) existingUser.height = profileDetails.height;

if (
  Array.isArray(profileDetails?.interests) &&
  profileDetails.interests.length > 0
) {
  existingUser.interests = profileDetails.interests;
}

if (
  Array.isArray(profileDetails?.values) &&
  profileDetails.values.length > 0
) {
  existingUser.values = profileDetails.values;
}

// prompts
if (Array.isArray(prompts) && prompts.length > 0) {
  existingUser.prompts = prompts;
}


    if (Array.isArray(photos) && photos.length > 0) {
      console.log("📸 Updating photos:", photos);
      existingUser.photos = photos;
    }

    // ✅ CRITICAL 2.1 CHECKPOINT — ONBOARDING COMPLETE
    existingUser.onboardingStage = "COMPLETE";

    console.log("💾 Saving updated profile with onboarding COMPLETE…");
    await existingUser.save();
    console.log("✅ User profile saved and onboarding marked COMPLETE.");

    const profileComplete = calculateProfileCompleteness(existingUser);
    console.log("📊 Profile completeness:", profileComplete);

    const fixedPhotos = (existingUser.photos || []).map((p) => p);

    const profilePayload = {
      _id: existingUser._id,
      name: existingUser.name,
      username: existingUser.username,
      phoneNumber: existingUser.phoneNumber,
      dateOfBirth: existingUser.dateOfBirth,
      gender: existingUser.gender,
      height: existingUser.height,
      interests: existingUser.interests,
      values: existingUser.values,
      prompts: existingUser.prompts,
      photos: fixedPhotos,
      profileComplete,

      pronouns: existingUser.pronouns,
      sexuality: existingUser.sexuality,
      work: existingUser.work,
      jobTitle: existingUser.jobTitle,
      college: existingUser.college,
      educationLevel: existingUser.educationLevel,
      religion: existingUser.religion,
      homeTown: existingUser.homeTown,
      politics: existingUser.politics,
      languages: existingUser.languages,
      datingIntentions: existingUser.datingIntentions,
      relationshipType: existingUser.relationshipType,
      ethnicity: existingUser.ethnicity,
      children: existingUser.children,
      familyPlans: existingUser.familyPlans,
      pets: existingUser.pets,
      zodiacSign: existingUser.zodiacSign,
      drinking: existingUser.drinking,
      smoking: existingUser.smoking,
      marijuana: existingUser.marijuana,
      drugs: existingUser.drugs,
    };

    const accessToken = jwt.sign(
      {
        id: existingUser._id.toString(),
        phoneNumber: existingUser.phoneNumber,
        username: existingUser.username,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const refreshToken = jwt.sign(
      {
        id: existingUser._id.toString(),
        phoneNumber: existingUser.phoneNumber,
        username: existingUser.username,
      },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      success: true,
      message: "Profile saved successfully.",
      data: {
        profile: profilePayload,
        accessToken,
        refreshToken,
      },
    });
  } catch (err) {
    console.error("🔥 ERROR in saveUserProfile:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error while saving profile.",
    });
  }
};






// Fetch User Profile by Phone Number (JWT)
// Fetch User Profile by Phone Number (JWT)
export const getProfileByPhoneNumber = async (req, res) => {
  try {
    // 🔑 Always trust authMiddleware
    const userId = req.user.id;

    console.log("🔍 [getProfileByPhoneNumber] Fetching user for ID:", userId);

    const user = await UserProfile.findById(userId);

    if (!user) {
      console.log("❌ [getProfileByPhoneNumber] User not found");
      return res.status(404).json({
        success: false,
        message: 'User profile not found.',
      });
    }

    console.log("✅ [getProfileByPhoneNumber] User found:", {
      id: user._id.toString(),
      onboardingStage: user.onboardingStage,
    });

    // 📊 Calculate profile completeness

    const profileCompleteness = calculateProfileCompleteness(user);

    // 🖼 Normalize photo URLs
    // const fixedPhotos = (user.photos || []).map(photo => {
    //   if (photo.startsWith("http") || photo.startsWith("data:")) return photo;
    //   const normalized = photo.replace(/\\/g, "/");
    //   return `http://172.20.10.4:5000/${normalized}`;
    // });
    const fixedPhotos = (user.photos || [])
  .filter(photo => typeof photo === "string" && photo.length > 0)
  .map(photo => {
    // 🔵 S3 URL (future)
    if (photo.startsWith("http")) return photo;

    // 🟢 LOCAL upload
    const normalized = photo.replace(/\\/g, "/");
    return `${process.env.BASE_URL || "http://172.20.10.4:5000"}/${normalized}`;
  });


    console.log("📤 [getProfileByPhoneNumber] Returning profile snapshot:", {
      name: user.name,
      phoneNumber: user.phoneNumber,
      onboardingStage: user.onboardingStage,
    });

    res.status(200).json({
      success: true,
      message: 'User profile fetched successfully!',
      data: {
        // 🔥 REQUIRED FOR AUTHGATE (CORE FIX)
        onboardingStage: user.onboardingStage,

        // Core profile fields
        name: user.name,
        phoneNumber: user.phoneNumber,
        username: user.username,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        height: user.height,
        interests: user.interests,
        values: user.values,
        prompts: user.prompts || [],
        photos: fixedPhotos,
        profileComplete: profileCompleteness,

        // Extended profile fields
        pronouns: user.pronouns,
        sexuality: user.sexuality,
        work: user.work,
        jobTitle: user.jobTitle,
        college: user.college,
        educationLevel: user.educationLevel,
        religion: user.religion,
        homeTown: user.homeTown,
        politics: user.politics,
        languages: user.languages,
        datingIntentions: user.datingIntentions,
        relationshipType: user.relationshipType,
        ethnicity: user.ethnicity,
        children: user.children,
        familyPlans: user.familyPlans,
        covidVaccine: user.covidVaccine,
        pets: user.pets,
        zodiacSign: user.zodiacSign,
        drinking: user.drinking,
        smoking: user.smoking,
        marijuana: user.marijuana,
        drugs: user.drugs,
      },
    });
  } catch (error) {
    console.error('🔥 [getProfileByPhoneNumber] Error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching the user profile.',
    });
  }
};




// export const getUserByJWT = async (req, res) => {
//   try {
//     const { phoneNumber } = req.user; // Extract phoneNumber from JWT token

//     const user = await UserProfile.findOne({ phoneNumber });
//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found.',
//       });
//     }

//     res.status(200).json({
//       success: true,
//       data: {
//         username: user.username,
//       },
//     });
//   } catch (error) {
//     console.error('Error fetching user:', error);
//     res.status(500).json({
//       success: false,
//       message: 'An error occurred while fetching user.',
//     });
//   }
// };

const DEFAULT_DISCOVERY_LIMIT = 8;
const MAX_DISCOVERY_LIMIT = 20;
const MAX_DISCOVERY_CANDIDATES = 200;
const EARTH_RADIUS_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;

const DISCOVERY_PROFILE_SELECT = [
  "_id",
  "name",
  "username",
  "dateOfBirth",
  "gender",
  "height",
  "interests",
  "values",
  "prompts",
  "photos",
  "pronouns",
  "sexuality",
  "work",
  "jobTitle",
  "college",
  "educationLevel",
  "religion",
  "homeTown",
  "politics",
  "languages",
  "datingIntentions",
  "relationshipType",
  "ethnicity",
  "children",
  "familyPlans",
  "covidVaccine",
  "pets",
  "zodiacSign",
  "drinking",
  "smoking",
  "marijuana",
  "drugs",
  "location",
  "locationGeo",
  "lastActiveAt",
  "updatedAt",
].join(" ");

// ===== UTILITY FUNCTIONS =====

function parseDiscoveryNumber(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDiscoveryFilters(rawFilters, fallbackInterests = []) {
  const safeFilters = rawFilters && typeof rawFilters === "object" ? rawFilters : {};
  const parsedDistance = Number(safeFilters.distanceKm);

  const safeStringArray = (arr) =>
    Array.isArray(arr) ? arr.filter((v) => typeof v === "string" && v.trim()) : [];

  const rawInterests = safeStringArray(safeFilters.interests);

  return {
    ageRange:
      safeFilters.ageRange?.min && safeFilters.ageRange?.max
        ? {
            min: Math.max(Number(safeFilters.ageRange.min), 18),
            max: Math.max(Number(safeFilters.ageRange.max), Number(safeFilters.ageRange.min)),
          }
        : null,
    ageFlex: Boolean(safeFilters.ageFlex),
    distanceKm: Number.isFinite(parsedDistance) && parsedDistance > 0 ? parsedDistance : null,
    distanceFlex: Boolean(safeFilters.distanceFlex),
    interests: rawInterests.length > 0 ? rawInterests : fallbackInterests,
    // Lifestyle preference filters (soft — boost score, never hard exclude)
    datingIntentions: safeStringArray(safeFilters.datingIntentions),
    religion: safeStringArray(safeFilters.religion),
    ethnicity: safeStringArray(safeFilters.ethnicity),
    drinking: safeStringArray(safeFilters.drinking),
    smoking: safeStringArray(safeFilters.smoking),
    // Hard cutoff: only show profiles active in the last 7 days
    activeOnly: Boolean(safeFilters.activeOnly),
    // Event-based discovery scope (Explore Iteration 2): EVERYONE | EVENT_GOERS | MY_CIRCLES
    eventScope: ["EVENT_GOERS", "MY_CIRCLES"].includes(safeFilters.eventScope)
      ? safeFilters.eventScope
      : "EVERYONE",
  };
}

// Uses preferredGender field if set; falls back to binary Man↔Woman pairing
function resolvePreferredGender(userProfile) {
  if (Array.isArray(userProfile.preferredGender) && userProfile.preferredGender.length > 0) {
    return userProfile.preferredGender;
  }
  if (userProfile.gender === "Man") return ["Woman"];
  if (userProfile.gender === "Woman") return ["Man"];
  return null;
}

function calculateDistanceKm(latA, lngA, latB, lngB) {
  if (
    typeof latA !== "number" || typeof lngA !== "number" ||
    typeof latB !== "number" || typeof lngB !== "number"
  ) return null;

  const dLat = (latB - latA) * DEG_TO_RAD;
  const dLng = (lngB - lngA) * DEG_TO_RAD;
  const latARad = latA * DEG_TO_RAD;
  const latBRad = latB * DEG_TO_RAD;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latARad) * Math.cos(latBRad) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateAgeFromDob(dob) {
  if (!dob) return null;
  const today = new Date();
  const birth = new Date(dob);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function getActivityLabel(lastActiveAt) {
  if (!lastActiveAt) return null;
  const diffDays = (Date.now() - new Date(lastActiveAt).getTime()) / 86400000;
  if (diffDays < 1) return "today";
  if (diffDays < 7) return "this week";
  return null;
}

async function getBlockedProfileIds(userId) {
  const blocks = await Block.find({
    $or: [{ blockerId: userId }, { blockedId: userId }],
  })
    .select("blockerId blockedId")
    .lean();

  return blocks.reduce((acc, block) => {
    const other =
      block.blockerId?.toString() === userId.toString()
        ? block.blockedId?.toString()
        : block.blockerId?.toString();
    if (other) acc.push(other);
    return acc;
  }, []);
}

// Reads from SwipeRecord (new); falls back to embedded UserProfile array (legacy data)
async function getSwipedProfileIds(userId, fallbackSwipedUserIds) {
  const records = await SwipeRecord.find({ swiperId: userId })
    .select("swipedId")
    .lean();

  if (records.length > 0) {
    return records.map((r) => r.swipedId.toString());
  }
  return (fallbackSwipedUserIds || []).map((id) => id.toString());
}

// Scores and sorts a pool of candidates.
// Priority: activity recency → shared interests → lifestyle match → distance → age.
// All filters are soft preferences — matching profiles rank higher but nothing is hard excluded
// (except activeOnly which is applied as a DB filter before this function runs).
function scoreAndRankCandidates({ candidates, requester, filters, sharedEventMap = {} }) {
  // Additive interests: filter interests + profile interests both contribute to scoring
  const effectiveInterests = [
    ...new Set([...(requester.interests || []), ...(filters.interests || [])]),
  ];
  const interestSet = new Set(effectiveInterests);

  const reqLat = requester.location?.latitude;
  const reqLng = requester.location?.longitude;
  const hasLocation = typeof reqLat === "number" && typeof reqLng === "number";

  // distanceFlex=false → heavier weight so nearby profiles surface much higher
  const distanceWeight = filters.distanceFlex ? 80 : 150;
  const ageWeight = filters.ageFlex ? 80 : 150;

  const scored = candidates.map((c) => {
    // Activity recency (0–300)
    const diffDays = c.lastActiveAt
      ? (Date.now() - new Date(c.lastActiveAt).getTime()) / 86400000
      : 999;
    const activityScore = diffDays < 1 ? 300 : diffDays < 7 ? 200 : diffDays < 30 ? 100 : 0;

    // Shared interests (0–200)
    const sharedCount = (c.interests || []).filter((i) => interestSet.has(i)).length;
    const interestScore = Math.min(sharedCount * 20, 200);

    // Lifestyle preference match (soft, 0–180 total)
    let lifestyleScore = 0;
    if (filters.datingIntentions?.length && c.datingIntentions) {
      if (filters.datingIntentions.includes(c.datingIntentions)) lifestyleScore += 80;
    }
    if (filters.religion?.length && c.religion) {
      if (filters.religion.includes(c.religion)) lifestyleScore += 40;
    }
    if (filters.ethnicity?.length && c.ethnicity) {
      if (filters.ethnicity.includes(c.ethnicity)) lifestyleScore += 20;
    }
    if (filters.drinking?.length && c.drinking) {
      if (filters.drinking.includes(c.drinking)) lifestyleScore += 20;
    }
    if (filters.smoking?.length && c.smoking) {
      if (filters.smoking.includes(c.smoking)) lifestyleScore += 20;
    }

    // Distance (0 or distanceWeight)
    let distanceScore = 0;
    let distKm = null;
    if (hasLocation && typeof c.location?.latitude === "number") {
      distKm = calculateDistanceKm(reqLat, reqLng, c.location.latitude, c.location.longitude);
      if (distKm !== null && filters.distanceKm && distKm <= filters.distanceKm) {
        distanceScore = distanceWeight;
      }
    }

    // Age (0 or ageWeight)
    let ageScore = 0;
    if (filters.ageRange && c.dateOfBirth) {
      const age = calculateAgeFromDob(c.dateOfBirth);
      if (age !== null && age >= filters.ageRange.min && age <= filters.ageRange.max) {
        ageScore = ageWeight;
      }
    }

    // Shared event within the last 48h (Explore Iteration 2 — "you were both at X")
    const sharedEventTitle = sharedEventMap[c._id.toString()] || null;
    const sharedEventScore = sharedEventTitle ? 250 : 0;

    return {
      ...c,
      _discoveryScore:
        activityScore + interestScore + lifestyleScore + distanceScore + ageScore + sharedEventScore,
      _sharedInterestCount: sharedCount,
      _distanceKm: distKm,
      _sharedEventTitle: sharedEventTitle,
    };
  });

  scored.sort((a, b) => {
    if (b._discoveryScore !== a._discoveryScore) return b._discoveryScore - a._discoveryScore;
    const aTime = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
    const bTime = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
    return bTime - aTime;
  });

  return scored;
}

async function buildDiscoveryDeck({ requester, filters, excludeSwiped = true }) {
  const userId = requester._id.toString();

  const [blockedIds, swipedIds] = await Promise.all([
    getBlockedProfileIds(userId),
    excludeSwiped
      ? getSwipedProfileIds(userId, requester.swipedUserIds)
      : Promise.resolve([]),
  ]);

  const allExcludedIds = [...new Set([...blockedIds, ...swipedIds])];
  const preferredGenders = resolvePreferredGender(requester);

  const baseMatch = {
    _id: {
      $ne: requester._id,
      ...(allExcludedIds.length && { $nin: allExcludedIds }),
    },
    $or: [
      { onboardingStage: "COMPLETE" },
      { onboardingStage: { $exists: false } },
      { onboardingStage: null },
      { onboardingStage: "" },
    ],
  };

  if (preferredGenders) {
    baseMatch.gender = { $in: preferredGenders };
  }

  // Hard filter: only include profiles active in the last 7 days
  if (filters.activeOnly) {
    baseMatch.lastActiveAt = { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) };
  }

  // Event-based discovery scope (Explore Iteration 2)
  if (filters.eventScope === "EVENT_GOERS") {
    baseMatch["eventStats.checkInCount"] = { $gte: 1 };
  } else if (filters.eventScope === "MY_CIRCLES") {
    const myEventIds = await EventRsvp.find({
      userId: requester._id,
      status: { $in: ["GOING", "CHECKED_IN"] },
    }).distinct("eventId");

    if (myEventIds.length === 0) return [];

    const circleUserIds = await EventRsvp.find({
      eventId: { $in: myEventIds },
      status: { $in: ["GOING", "CHECKED_IN"] },
      showMeInCircle: true,
      userId: { $ne: requester._id },
    }).distinct("userId");

    if (circleUserIds.length === 0) return [];
    baseMatch._id.$in = circleUserIds;
  }

  const candidates = await UserProfile.find(baseMatch)
    .select(DISCOVERY_PROFILE_SELECT)
    .sort({ lastActiveAt: -1, updatedAt: -1, _id: -1 })
    .limit(MAX_DISCOVERY_CANDIDATES)
    .lean();

  const sharedEventMap = await buildSharedEventMap(requester._id, candidates);

  return scoreAndRankCandidates({ candidates, requester, filters, sharedEventMap });
}

// "You were both at X" — checked into the same event within the last 48h.
async function buildSharedEventMap(requesterId, candidates) {
  if (candidates.length === 0) return {};

  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const myRecentCheckIns = await EventRsvp.find({
    userId: requesterId,
    status: "CHECKED_IN",
    checkedInAt: { $gte: cutoff },
  })
    .select("eventId eventSnapshot")
    .lean();

  if (myRecentCheckIns.length === 0) return {};

  const eventTitleById = new Map(myRecentCheckIns.map((r) => [r.eventId.toString(), r.eventSnapshot?.title]));
  const candidateIds = candidates.map((c) => c._id);

  const theirCheckIns = await EventRsvp.find({
    userId: { $in: candidateIds },
    eventId: { $in: myRecentCheckIns.map((r) => r.eventId) },
    status: "CHECKED_IN",
  })
    .select("userId eventId")
    .lean();

  const map = {};
  for (const r of theirCheckIns) {
    const title = eventTitleById.get(r.eventId.toString());
    if (title) map[r.userId.toString()] = title;
  }
  return map;
}

export const getFilteredProfiles = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const requester = await UserProfile.findById(req.user.id).lean();
    if (!requester) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const filters = normalizeDiscoveryFilters(req.body?.filters, requester.interests || []);
    const limit = Math.min(
      parseDiscoveryNumber(req.body?.limit || req.query?.limit, DEFAULT_DISCOVERY_LIMIT),
      MAX_DISCOVERY_LIMIT
    );
    // cursor = _id of the last profile received by the client; null means start of deck
    const cursor = req.body?.cursor || null;
    const forceRebuild = Boolean(req.body?.forceRebuild);
    const filtersKey = JSON.stringify(filters);
    const userId = requester._id.toString();

    let deck = getCachedDeck(userId, filtersKey);
    let recycled = false;

    if (!deck || forceRebuild) {
      deck = await buildDiscoveryDeck({ requester, filters, excludeSwiped: true });
      if (deck.length === 0) {
        recycled = true;
        deck = await buildDiscoveryDeck({ requester, filters, excludeSwiped: false });
      }
      setCachedDeck(userId, deck, filtersKey);
    }

    // Resolve cursor position — if cursor not found (cache rebuilt), start from top
    let startIndex = 0;
    if (cursor) {
      const cursorIdx = deck.findIndex((p) => p._id.toString() === cursor);
      if (cursorIdx !== -1) startIndex = cursorIdx + 1;
    }

    const page = deck.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + page.length < deck.length;
    const nextCursor = page.length > 0 ? page[page.length - 1]._id.toString() : null;

    return res.status(200).json({
      success: true,
      profiles: mapProfiles(page),
      pagination: {
        nextCursor,
        hasMore,
        recycled,
      },
    });
  } catch (error) {
    console.error("FilteredProfiles error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch filtered profiles",
    });
  }
};

export const getDiscoveryPreferences = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const user = await UserProfile.findById(req.user.id).select("discoveryPreferences").lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    return res.status(200).json({ success: true, preferences: user.discoveryPreferences || {} });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Failed to fetch discovery preferences" });
  }
};

function mapProfiles(users) {
  return users.map((user) => ({
    _id: user._id,
    name: user.name,
    username: user.username,
    dateOfBirth: user.dateOfBirth,
    age: calculateAgeFromDob(user.dateOfBirth),
    gender: user.gender,
    height: user.height,
    interests: user.interests,
    values: user.values,
    prompts: user.prompts || [],
    photos: user.photos || [],
    pronouns: user.pronouns || "",
    sexuality: user.sexuality || "",
    work: user.work || "",
    jobTitle: user.jobTitle || "",
    college: user.college || "",
    educationLevel: user.educationLevel || "",
    religion: user.religion || "",
    homeTown: user.homeTown || "",
    politics: user.politics || "",
    languages: user.languages || [],
    datingIntentions: user.datingIntentions || "",
    relationshipType: user.relationshipType || "",
    ethnicity: user.ethnicity || "",
    children: user.children || "",
    familyPlans: user.familyPlans || "",
    covidVaccine: user.covidVaccine || "",
    pets: user.pets || "",
    zodiacSign: user.zodiacSign || "",
    drinking: user.drinking || "",
    smoking: user.smoking || "",
    marijuana: user.marijuana || "",
    drugs: user.drugs || "",
    sharedInterestCount: user._sharedInterestCount || 0,
    distanceKm: typeof user._distanceKm === "number" ? Number(user._distanceKm.toFixed(1)) : null,
    activityLabel: getActivityLabel(user.lastActiveAt),
    sharedEventTitle: user._sharedEventTitle || null,
  }));
}




export const handleSwipe = async (req, res) => {
  try {
    const { id: loggedInUserId } = req.user;
    const { swipedUserId, action } = req.body;

    console.log("\n================= SWIPE API CALLED =================");
    console.log("Action:", action);
    console.log("Logged-in User (liker):", loggedInUserId);
    console.log("Target User (swipedUserId):", swipedUserId);

    if (!swipedUserId || !["like", "dislike"].includes(action)) {
      console.log("❌ Invalid swipe request");
      return res.status(400).json({ success: false, message: "Invalid request" });
    }

    const loggedInUser = await UserProfile.findById(loggedInUserId);
    const swipedUser = await UserProfile.findById(swipedUserId);

    if (!loggedInUser || !swipedUser) {
      console.log("❌ One of the users not found in DB");
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Ensure arrays exist
    loggedInUser.swipedRight ||= [];
    loggedInUser.swipedLeft ||= [];
    loggedInUser.matches ||= [];
    swipedUser.swipedRight ||= [];
    swipedUser.matches ||= [];

    console.log("BEFORE UPDATE:");
    console.log("loggedInUser.swipedRight =", loggedInUser.swipedRight);
    console.log("swipedUser.swipedRight =", swipedUser.swipedRight);

    if (action === "like") {
      console.log("➡ Processing LIKE action");

      // Upsert Like
      await Like.findOneAndUpdate(
        { likerId: loggedInUserId, likedUserId: swipedUserId },
        {
          $setOnInsert: {
            likerId: loggedInUserId,
            likedUserId: swipedUserId,
            status: "pending",
          },
        },
        { upsert: true, new: true }
      );

      // Update swipedRight for liker
      if (!loggedInUser.swipedRight.some(id => id.toString() === swipedUserId.toString())) {
        loggedInUser.swipedRight.push(swipedUserId);
      }

      console.log("AFTER updating liker swipedRight:", loggedInUser.swipedRight);

      // Check mutual like
      const userBLikedA = swipedUser.swipedRight.some(
        (id) => id.toString() === loggedInUserId.toString()
      );

      console.log("🔍 MUTUAL LIKE CHECK:");
      console.log("Does swipedUser.swipedRight contain loggedInUserId? =", userBLikedA);

      if (userBLikedA) {
        console.log("🎉 MATCH DETECTED!");

        // Add to matches
        if (!loggedInUser.matches.includes(swipedUserId)) loggedInUser.matches.push(swipedUserId);
        if (!swipedUser.matches.includes(loggedInUserId)) swipedUser.matches.push(loggedInUserId);

        // Create / reuse chat
        const pairKey = [loggedInUserId.toString(), swipedUserId.toString()]
          .sort()
          .join("|");

        console.log("Chat pairKey:", pairKey);

        let chat = await Chat.findOne({
          pairKey,
          status: { $in: ["pending", "accepted"] },
        });

        if (!chat) {
          console.log("Creating NEW chat for match");
          chat = new Chat({
            senderId: loggedInUserId,
            receiverId: swipedUserId,
            status: "accepted",
            pairKey,
            participants: [loggedInUserId, swipedUserId],
            lastActivityAt: new Date(),
          });
        } else {
          console.log("Reusing EXISTING chat");
          chat.status = "accepted";
          chat.participants = [loggedInUserId, swipedUserId];
          chat.lastActivityAt = new Date();
        }

        // Twilio channel creation
        if (!chat.twilioChannelSid) {
          try {
            const service = client.chat.v2.services(process.env.TWILIO_CHAT_SERVICE_SID);
            const friendlyName = `${loggedInUserId}-${swipedUserId}`;
            const uniqueName = `chat-${pairKey}`;

            console.log("Creating Twilio channel:", uniqueName);

            const created = await service.channels.create({ friendlyName, uniqueName });

            if (created?.sid) {
              chat.twilioChannelSid = created.sid;
              chat.twilioChatChannelSid = chat.twilioChatChannelSid || created.sid;
            }
          } catch (err) {
            console.log("⚠ Twilio Error:", err?.message);
          }
        }

        // Update Like status
        console.log("Updating Like documents to status: matched");

        await Like.updateMany(
          {
            $or: [
              { likerId: loggedInUserId, likedUserId: swipedUserId },
              { likerId: swipedUserId, likedUserId: loggedInUserId },
            ],
          },
          { $set: { status: "matched" } }
        );

        await chat.save();
        await loggedInUser.save();
        await swipedUser.save();

        console.log("🎯 MATCH RESPONSE SENT");

        return res.status(200).json({
          success: true,
          message: "Swipe recorded successfully",
          isMatch: true,
          chatId: chat._id,
          twilioChannelSid: chat.twilioChannelSid || chat.twilioChatChannelSid || null,
          otherUser: {
            _id: swipedUser._id,
            name: swipedUser.name,
            photos: swipedUser.photos || [],
          },
        });
      }
    }

    // Dislike flow
    if (action === "dislike") {
      console.log("➡ Processing DISLIKE action");

      if (!loggedInUser.swipedLeft.includes(swipedUserId)) {
        loggedInUser.swipedLeft.push(swipedUserId);
      }
    }

    // Save tracking
    console.log("Saving non-match swipe...");
    await UserProfile.findByIdAndUpdate(loggedInUserId, {
      $addToSet: { swipedUserIds: swipedUserId },
    });

    await loggedInUser.save();
    await swipedUser.save();

    console.log("Swipe saved with NO MATCH");
    console.log("====================================================");

    return res.status(200).json({
      success: true,
      message: "Swipe recorded successfully",
      isMatch: false,
    });

  } catch (error) {
    console.error("❌ ERROR IN handleSwipe:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while handling swipe.",
    });
  }
};




const uploadPhotosLegacy = async (req, res) => {
  let uploadedFileUrls = [];
  let uploadPersisted = false;

  try {
    console.log('📸 [uploadPhotos] Full req.body:', req.body);
    console.log('📸 [uploadPhotos] Uploaded files:', req.files);
    console.log('📸 [uploadPhotos] Auth user:', req.user);

    const userId = req.user?.id;
    const phoneFromToken = req.user?.phoneNumber;
    const replaceIndex =
      req.body.replaceIndex !== undefined && req.body.replaceIndex !== null
        ? Number(req.body.replaceIndex)
        : null;
    const replaceAll =
      req.body.replaceAll === true || req.body.replaceAll === "true";
    const requestedOnboardingStage = req.body.onboardingStage;

    // 🔒 Auth check (JWT is the source of truth)
    if (!userId || !phoneFromToken) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: missing user in token',
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files were uploaded.',
      });
    }

    {
      const user = await UserProfile.findById(userId);

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found.',
        });
      }

      if (!Array.isArray(user.photos)) {
        user.photos = [];
      }

      const s3UploadedFiles = await Promise.all(
        req.files.map((file) => uploadPhotoToS3(file, userId))
      );
      const s3FileUrls = s3UploadedFiles.map((file) => file.url);
      uploadedFileUrls = s3FileUrls;
      console.log('ðŸ“¸ [uploadPhotos] S3 file URLs:', s3FileUrls);

      const allowedOnboardingStages = [
        "PHONE_VERIFIED",
        "INTRO_DONE",
        "PROFILE_SETUP_DONE",
        "LOCATION_DONE",
        "DETAILS_DONE",
        "PROMPTS_DONE",
        "PHOTOS_DONE",
        "COMPLETE",
      ];

      const pendingFileDeletes = [];

      if (replaceAll) {
        console.log("â™»ï¸ [uploadPhotos] Replacing entire photo set");
        for (const existingPhoto of user.photos || []) {
          pendingFileDeletes.push(existingPhoto);
        }
        user.photos = s3FileUrls;
      } else if (
        replaceIndex !== null &&
        Number.isInteger(replaceIndex) &&
        replaceIndex >= 0
      ) {
        console.log(`ðŸ” [uploadPhotos] Replacing photo at index ${replaceIndex}`);
        const existingPhoto = user.photos?.[replaceIndex];
        if (existingPhoto && existingPhoto !== s3FileUrls[0]) {
          pendingFileDeletes.push(existingPhoto);
        }
        user.photos[replaceIndex] = s3FileUrls[0];
      } else {
        console.log('âž• [uploadPhotos] Appending photos');
        user.photos.push(...s3FileUrls);
      }

      if (
        typeof requestedOnboardingStage === "string" &&
        allowedOnboardingStages.includes(requestedOnboardingStage)
      ) {
        user.onboardingStage = requestedOnboardingStage;
      }

      await user.save();
      uploadPersisted = true;
      console.log('âœ… [uploadPhotos] Photos saved successfully');

      await deleteStoredPhotos(pendingFileDeletes, "uploadPhotos");

      return res.status(200).json({
        success: true,
        message: 'Photos uploaded successfully!',
        data: {
          photos: user.photos,
          uploadedUrls: s3FileUrls,
          onboardingStage: user.onboardingStage,
        },
      });
    }

    const toPublicFileUrl = (file) => {
      if (file.location) {
        return file.location;
      }

      const filename = file.filename || path.basename(file.path || "");
      return `${req.protocol}://${req.get("host")}/uploads/${filename}`;
    };

    const fileUrls = req.files.map(toPublicFileUrl);
    console.log('📸 [uploadPhotos] File URLs:', fileUrls);

    const deleteLocalUploadIfPresent = (fileUrl) => {
      if (typeof fileUrl !== "string" || !fileUrl.includes("/uploads/")) {
        return;
      }

      const filename = fileUrl.split("/uploads/")[1];
      if (!filename) {
        return;
      }

      const decodedFilename = decodeURIComponent(filename.split("?")[0]);
      const filePath = path.resolve("uploads", decodedFilename);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log("🗑 [uploadPhotos] Deleted local upload:", filePath);
      }
    };

    // ✅ Fetch user by ID (NOT phone number)
    const user = await UserProfile.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    const allowedOnboardingStages = [
      "PHONE_VERIFIED",
      "INTRO_DONE",
      "PROFILE_SETUP_DONE",
      "LOCATION_DONE",
      "DETAILS_DONE",
      "PROMPTS_DONE",
      "PHOTOS_DONE",
      "COMPLETE",
    ];

    const pendingFileDeletes = [];

    if (replaceAll) {
      console.log("♻️ [uploadPhotos] Replacing entire photo set");
      for (const existingPhoto of user.photos || []) {
        pendingFileDeletes.push(existingPhoto);
      }
      user.photos = fileUrls;
    } else if (replaceIndex !== null && Number.isInteger(replaceIndex) && replaceIndex >= 0) {
      console.log(`🔁 [uploadPhotos] Replacing photo at index ${replaceIndex}`);
      const existingPhoto = user.photos?.[replaceIndex];
      if (existingPhoto && existingPhoto !== fileUrls[0]) {
        pendingFileDeletes.push(existingPhoto);
      }
      user.photos[replaceIndex] = fileUrls[0];
    } else {
      console.log('➕ [uploadPhotos] Appending photos');
      user.photos.push(...fileUrls);
    }

    if (
      typeof requestedOnboardingStage === "string" &&
      allowedOnboardingStages.includes(requestedOnboardingStage)
    ) {
      user.onboardingStage = requestedOnboardingStage;
    }

    await user.save();
    console.log('✅ [uploadPhotos] Photos saved successfully');

    await deleteStoredPhotos(pendingFileDeletes, "updateUserProfile");

    return res.status(200).json({
      success: true,
      message: 'Photos uploaded successfully!',
      data: {
        photos: user.photos,
        uploadedUrls: fileUrls,
        onboardingStage: user.onboardingStage,
      },
    });
  } catch (error) {
    console.error('🔥 [uploadPhotos] ERROR:', error);
    if (!uploadPersisted && uploadedFileUrls.length > 0) {
      await deleteStoredPhotos(uploadedFileUrls, "uploadPhotosRollback");
    }

    return res.status(500).json({
      success: false,
      message: 'An error occurred while uploading photos.',
    });
  }
};






export const uploadPhotos = async (req, res) => {
  let uploadedFileUrls = [];
  let uploadPersisted = false;

  try {
    console.log("[uploadPhotos] Full req.body:", req.body);
    console.log("[uploadPhotos] Uploaded files:", req.files);
    console.log("[uploadPhotos] Auth user:", req.user);

    const userId = req.user?.id;
    const phoneFromToken = req.user?.phoneNumber;
    const replaceIndex =
      req.body.replaceIndex !== undefined && req.body.replaceIndex !== null
        ? Number(req.body.replaceIndex)
        : null;
    const replaceAll =
      req.body.replaceAll === true || req.body.replaceAll === "true";
    const requestedOnboardingStage = req.body.onboardingStage;

    if (!userId || !phoneFromToken) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: missing user in token",
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No files were uploaded.",
      });
    }

    const user = await UserProfile.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    if (!Array.isArray(user.photos)) {
      user.photos = [];
    }

    const uploadedFiles = await Promise.all(
      req.files.map((file) => uploadPhotoToS3(file, userId))
    );
    const fileUrls = uploadedFiles.map((file) => file.url);
    uploadedFileUrls = fileUrls;
    console.log("[uploadPhotos] Uploaded S3 URLs:", fileUrls);

    const allowedOnboardingStages = [
      "PHONE_VERIFIED",
      "INTRO_DONE",
      "PROFILE_SETUP_DONE",
      "LOCATION_DONE",
      "DETAILS_DONE",
      "PROMPTS_DONE",
      "PHOTOS_DONE",
      "COMPLETE",
    ];

    const pendingFileDeletes = [];

    if (replaceAll) {
      console.log("[uploadPhotos] Replacing entire photo set");
      pendingFileDeletes.push(...(user.photos || []));
      user.photos = fileUrls;
    } else if (
      replaceIndex !== null &&
      Number.isInteger(replaceIndex) &&
      replaceIndex >= 0
    ) {
      console.log(`[uploadPhotos] Replacing photo at index ${replaceIndex}`);
      const existingPhoto = user.photos?.[replaceIndex];
      if (existingPhoto && existingPhoto !== fileUrls[0]) {
        pendingFileDeletes.push(existingPhoto);
      }
      user.photos[replaceIndex] = fileUrls[0];
    } else {
      console.log("[uploadPhotos] Appending photos");
      user.photos.push(...fileUrls);
    }

    if (
      typeof requestedOnboardingStage === "string" &&
      allowedOnboardingStages.includes(requestedOnboardingStage)
    ) {
      user.onboardingStage = requestedOnboardingStage;
    }

    await user.save();
    uploadPersisted = true;
    console.log("[uploadPhotos] Photos saved successfully");

    await deleteStoredPhotos(pendingFileDeletes, "uploadPhotos");

    return res.status(200).json({
      success: true,
      message: "Photos uploaded successfully!",
      data: {
        photos: user.photos,
        uploadedUrls: fileUrls,
        onboardingStage: user.onboardingStage,
      },
    });
  } catch (error) {
    console.error("[uploadPhotos] ERROR:", error);

    if (!uploadPersisted && uploadedFileUrls.length > 0) {
      await deleteStoredPhotos(uploadedFileUrls, "uploadPhotosRollback");
    }

    return res.status(500).json({
      success: false,
      message: "An error occurred while uploading photos.",
    });
  }
};

// export const updateUserProfile = async (req, res) => {
//   try {
//       console.log("dY\" Incoming Update Request:", req.body);
//       console.log("dY\", Uploaded Files:", req.files);

//       let { phoneNumber, name, username, dob, gender, height, interests, values } = req.body;

//       if (!phoneNumber || phoneNumber === "null") {
//           console.error("ƒ?O Missing phone number in request!");
//           return res.status(400).json({ success: false, message: "Phone number is required and cannot be null." });
//       }

//       console.log(`dY\"? Searching for user profile with phone number: ${phoneNumber}`);

//       // ƒo. Get uploaded photo URLs
//       const photoUrls = req.files?.map(file => file.path) || [];

//       // ƒo. Check if profile exists
//       const existingProfile = await UserProfile.findOne({ phoneNumber });

//       if (!existingProfile) {
//           console.error("ƒ?O User profile not found for phone number:", phoneNumber);
//           return res.status(404).json({ success: false, message: "User profile not found." });
//       }

//       // ƒo. Construct updated fields
//       const updatedFields = {
//           name: name || existingProfile.name,
//           username: username || existingProfile.username,
//           dateOfBirth: dob || existingProfile.dateOfBirth,
//           gender: gender || existingProfile.gender,
//           height: height || existingProfile.height,
//           interests: interests ? JSON.parse(interests) : existingProfile.interests,
//           values: values ? JSON.parse(values) : existingProfile.values,
//       };

//       // ƒo. Append photos if uploaded
//       if (photoUrls.length > 0) {
//           updatedFields.photos = photoUrls;
//       }

//       // ƒo. Update user profile
//       const updatedProfile = await UserProfile.findOneAndUpdate(
//           { phoneNumber },
//           { $set: updatedFields },
//           { new: true }
//       );

//       console.log("ƒo. Updated Profile:", updatedProfile);
//       res.json({ success: true, message: "Profile updated successfully!", data: updatedProfile });

//   } catch (error) {
//       console.error("ƒ?O Profile Update Error:", error);
//       res.status(500).json({ success: false, message: "Failed to update profile." });
//   }
// };



export const updateUserProfile = async (req, res) => {
  console.log("🛠 [updateUserProfile] Raw body:", req.body);
  console.log("🛡 [updateUserProfile] Auth user:", req.user);

  try {
    const userId = req.user?.id;
    const phoneFromToken = req.user?.phoneNumber;

    if (!userId || !phoneFromToken) {
      console.log("❌ [updateUserProfile] Missing auth user details");
      return res.status(401).json({
        success: false,
        message: "Unauthorized: missing user in token",
      });
    }

    // Load user
    const user = await UserProfile.findById(userId);
    if (!user) {
      console.log("❌ [updateUserProfile] User not found for ID:", userId);
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    console.log("✅ [updateUserProfile] Found user:", {
      id: user._id.toString(),
      currentOnboardingStage: user.onboardingStage,
    });

    const updates =
      req.body.updates && typeof req.body.updates === "object"
        ? req.body.updates
        : req.body;

    console.log("✏️ [updateUserProfile] Parsed updates:", updates);

    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields provided to update.",
      });
    }

    // ✅ ALLOWED FIELDS (FIXED)
    const allowedFields = [
      // Core profile
      "name",
      "username",
      "dateOfBirth",
      "gender",
      "height",
      "interests",
      "values",
      "prompts",
      "photos",

      // ✅ ADDED — LOCATION SUPPORT
      "location",
      "deliveryAddress",
      // 🔹 ONBOARDING CHECKPOINT
      "onboardingStage",

      // Identity + lifestyle fields
      "pronouns",
      "sexuality",
      "work",
      "jobTitle",
      "college",
      "educationLevel",
      "religion",
      "homeTown",
      "politics",
      "languages",
      "datingIntentions",
      "relationshipType",
      "ethnicity",
      "children",
      "familyPlans",
      "pets",
      "zodiacSign",
      "drinking",
      "smoking",
      "marijuana",
      "drugs",
      // Discovery
      "preferredGender",
      "discoveryPreferences",
      // Safety / commerce prefs
      "safetyPreferences",
    ];

    // ✅ Allowed onboarding stages (guardrail)
    const ALLOWED_ONBOARDING_STAGES = [
      "PHONE_VERIFIED",
      "INTRO_DONE",
      "PROFILE_SETUP_DONE",

      // ✅ ADDED — LOCATION CHECKPOINT
      "LOCATION_DONE",

      "DETAILS_DONE",
      "PROMPTS_DONE",
      "PHOTOS_DONE",
      "COMPLETE",
    ];

    let anyFieldUpdated = false;
    const pendingFileDeletes = [];

    const deleteLocalUploadIfPresent = (fileUrl) => {
      if (typeof fileUrl !== "string" || !fileUrl.includes("/uploads/")) {
        return;
      }

      const filename = fileUrl.split("/uploads/")[1];
      if (!filename) {
        return;
      }

      const decodedFilename = decodeURIComponent(filename.split("?")[0]);
      const filePath = path.resolve("uploads", decodedFilename);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log("🗑 [updateUserProfile] Deleted local upload:", filePath);
      }
    };

    for (const key of Object.keys(updates)) {
      if (!allowedFields.includes(key)) {
        console.log(`⚠️ [updateUserProfile] Ignoring disallowed field: ${key}`);
        continue;
      }

      let value = updates[key];


      // ================================
  // 🔒 AUTO-FILL DELIVERY PHONE (C PART)
  // ================================
  if (key === "deliveryAddress" && typeof value === "object" && value !== null) {
    value = {
      ...value,
      phone: user.phoneNumber, // 🔥 enforce phone from token
    };
    console.log(
      "📦 [updateUserProfile] deliveryAddress phone auto-filled:",
      user.phoneNumber
    );
  }
  // ================================

      if (key === "username") {
        value = normalizeUsernameInput(value);
        if (!value) {
          console.log("⚠️ [updateUserProfile] Ignoring empty username update");
          continue;
        }
      }

      if (key === "onboardingStage") {
        if (!ALLOWED_ONBOARDING_STAGES.includes(value)) {
          console.log(
            "❌ [updateUserProfile] Invalid onboardingStage rejected:",
            value
          );
          continue;
        }

        console.log(
          `🧭 [updateUserProfile] Updating onboardingStage: ${user.onboardingStage} → ${value}`
        );
      } else {
        console.log(`✏️ [updateUserProfile] Setting ${key} =`, value);
      }

      if (key === "photos" && Array.isArray(value)) {
        const nextPhotos = value.filter(
          (photo) => typeof photo === "string" && photo.trim().length > 0
        );
        const removedPhotos = (user.photos || []).filter(
          (photo) => !nextPhotos.includes(photo)
        );

        for (const removedPhoto of removedPhotos) {
          pendingFileDeletes.push(removedPhoto);
        }

        value = nextPhotos;
      }

      user[key] = value;
      if (key === "deliveryAddress") {
      console.log(
        "✅ [updateUserProfile] deliveryAddress assigned to user object:",
        user.deliveryAddress
      );
    }

      anyFieldUpdated = true;
    }

    if (!anyFieldUpdated) {
      console.log("ℹ️ [updateUserProfile] No allowed fields found in updates.");
      return res.status(400).json({
        success: false,
        message: "No valid fields provided to update.",
      });
    }

    console.log("💾 [updateUserProfile] Saving user…");
    await user.save();
    console.log("✅ [updateUserProfile] User saved.");

    await deleteStoredPhotos(pendingFileDeletes, "updateUserProfile");

    const profileCompleteness = calculateProfileCompleteness(user);
    console.log(
      "📊 [updateUserProfile] Profile completeness:",
      profileCompleteness
    );

    const fixedPhotos = (user.photos || []).map((p) => p);

    const profilePayload = {
      _id: user._id,
      name: user.name,
      username: user.username,
      phoneNumber: user.phoneNumber,
      dateOfBirth: user.dateOfBirth,
      gender: user.gender,
      height: user.height,
      interests: user.interests,
      values: user.values,
      prompts: user.prompts || [],
      photos: fixedPhotos,
      profileComplete: profileCompleteness,

      onboardingStage: user.onboardingStage,

      pronouns: user.pronouns,
      sexuality: user.sexuality,
      work: user.work,
      jobTitle: user.jobTitle,
      college: user.college,
      educationLevel: user.educationLevel,
      religion: user.religion,
      homeTown: user.homeTown,
      politics: user.politics,
      languages: user.languages,
      datingIntentions: user.datingIntentions,
      relationshipType: user.relationshipType,
      ethnicity: user.ethnicity,
      children: user.children,
      familyPlans: user.familyPlans,
      pets: user.pets,
      zodiacSign: user.zodiacSign,
      drinking: user.drinking,
      smoking: user.smoking,
      marijuana: user.marijuana,
      drugs: user.drugs,
    };

    console.log("📤 [updateUserProfile] Final profilePayload:", profilePayload);

    const accessToken = jwt.sign(
      {
        id: user._id.toString(),
        phoneNumber: user.phoneNumber,
        username: user.username,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const refreshToken = jwt.sign(
      {
        id: user._id.toString(),
        phoneNumber: user.phoneNumber,
        username: user.username,
      },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    console.log("🔑 [updateUserProfile] New access & refresh tokens issued.");

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      data: {
        profile: profilePayload,
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    console.error("🔥 [updateUserProfile] ERROR:", error);

    if (
      error?.code === 11000 &&
      (error?.keyPattern?.username === 1 || error?.keyValue?.username)
    ) {
      return res.status(409).json({
        success: false,
        message: "Username already taken.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error while updating profile.",
    });
  }
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Links an email address to the logged-in user's account.
 * Isolated from updateUserProfile since email is a login credential
 * (uniqueness-enforced) rather than a general profile field.
 */
export const addEmail = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: missing user in token",
      });
    }

    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";

    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({
        success: false,
        message: "A valid email address is required.",
      });
    }

    const existing = await UserProfile.findOne({ email, _id: { $ne: userId } });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "This email is already linked to another account.",
      });
    }

    const user = await UserProfile.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    user.email = email;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Email linked to your account.",
      data: { email },
    });
  } catch (error) {
    console.error("🔥 [addEmail] ERROR:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This email is already linked to another account.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error while linking email.",
    });
  }
};



// Calculate Profile Completeness
export const calculateProfileCompleteness = (user) => {
  let totalFields = 0;
  let filledFields = 0;

  // List the required fields to be checked for completion
  const requiredFields = [
    'name',
    'dateOfBirth',
    'gender',
    'height',
    'interests',
    'values',
    'photos',
    'location',
    'pronouns',
    'sexuality',
    'work',
    'jobTitle',
    'college',
    'educationLevel',
    'religion',
    'homeTown',
    'politics',
    'languages',
    'datingIntentions',
    'relationshipType',
    'ethnicity',
    'children',
    'familyPlans',
    'covidVaccine',
    'pets',
    'zodiacSign',
    'drinking',
    'smoking',
    'marijuana',
    'drugs'
  ];

  requiredFields.forEach((field) => {
    totalFields++;

    // Check if the field is populated
    if (field === 'photos' && user[field]?.length > 0) {
      filledFields++; // Photos array should have at least one photo
    } else if (user[field] && (Array.isArray(user[field]) ? user[field].length > 0 : user[field] !== "")) {
      filledFields++;
    }
  });

  return (filledFields / totalFields) * 100; // Return percentage
};


export const reorderPhotos = async (req, res) => {
  console.log("🎯 [reorderPhotos] Body:", req.body);
  console.log("🛡 [reorderPhotos] Auth user:", req.user);

  try {
    const userId = req.user?.id;

    if (!userId) {
      console.log("❌ [reorderPhotos] Missing auth user id");
      return res.status(401).json({
        success: false,
        message: "Unauthorized: missing user in token",
      });
    }

    const { newOrder } = req.body;

    if (!Array.isArray(newOrder)) {
      console.log("❌ [reorderPhotos] newOrder is not an array");
      return res.status(400).json({
        success: false,
        message: "newOrder must be an array of photo URLs.",
      });
    }

    const user = await UserProfile.findById(userId);
    if (!user) {
      console.log("❌ [reorderPhotos] User not found for ID:", userId);
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const currentPhotos = user.photos || [];

    // Filter out any null/empty entries that may come from the frontend
    const cleanedNewOrder = newOrder.filter((p) => typeof p === "string" && p.trim().length > 0);

    // Basic integrity check: all items in newOrder must exist in currentPhotos
    const allExist = cleanedNewOrder.every((url) => currentPhotos.includes(url));
    if (!allExist) {
      console.log("⚠️ [reorderPhotos] Some URLs in newOrder do not exist in current photos.");
      return res.status(400).json({
        success: false,
        message: "Invalid photo URLs in newOrder.",
      });
    }

    // Optional: if newOrder doesn't include all photos (e.g. fewer), append remaining at the end
    const remaining = currentPhotos.filter((url) => !cleanedNewOrder.includes(url));
    const finalOrder = [...cleanedNewOrder, ...remaining];

    console.log("🧩 [reorderPhotos] Final ordered photos:", finalOrder);
    user.photos = finalOrder;

    await user.save();
    console.log("✅ [reorderPhotos] User photos reordered & saved.");

    const profileCompleteness = calculateProfileCompleteness(user);
    const fixedPhotos = (user.photos || []).map((p) => p);

    return res.status(200).json({
      success: true,
      message: "Photos reordered successfully.",
      data: {
        photos: fixedPhotos,
        profileComplete: profileCompleteness,
      },
    });
  } catch (error) {
    console.error("🔥 [reorderPhotos] ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while reordering photos.",
    });
  }
};


export const deletePhoto = async (req, res) => {
  console.log("🗑 [deletePhoto] Body:", req.body);
  console.log("🛡 [deletePhoto] Auth user:", req.user);

  try {
    const userId = req.user?.id;

    if (!userId) {
      console.log("❌ [deletePhoto] Missing auth user id");
      return res.status(401).json({
        success: false,
        message: "Unauthorized: missing user in token",
      });
    }

    const { index } = req.body;

    if (index === undefined || index === null) {
      console.log("❌ [deletePhoto] index not provided");
      return res.status(400).json({
        success: false,
        message: "index is required.",
      });
    }

    const user = await UserProfile.findById(userId);
    if (!user) {
      console.log("❌ [deletePhoto] User not found for ID:", userId);
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    const photos = user.photos || [];

    if (index < 0 || index >= photos.length) {
      console.log("❌ [deletePhoto] index out of range:", index);
      return res.status(400).json({
        success: false,
        message: "Invalid photo index.",
      });
    }

    const removedPhoto = photos[index];
    console.log("🗑 [deletePhoto] Removing photo at index:", index, "URL:", removedPhoto);
    photos.splice(index, 1); // remove one item at the index
    user.photos = photos;

    await user.save();
    console.log("✅ [deletePhoto] Photo removed & user saved.");

    if (typeof removedPhoto === "string" && removedPhoto.includes("/uploads/")) {
      const filename = removedPhoto.split("/uploads/")[1];
      if (filename) {
        const decodedFilename = decodeURIComponent(filename.split("?")[0]);
        const filePath = path.resolve("uploads", decodedFilename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log("🗑 [deletePhoto] Deleted local upload:", filePath);
        }
      }
    }

    await deleteStoredPhotoIfPresent(removedPhoto, "deletePhoto");

    const profileCompleteness = calculateProfileCompleteness(user);
    const fixedPhotos = (user.photos || []).map((p) => p);

    return res.status(200).json({
      success: true,
      message: "Photo deleted successfully.",
      data: {
        photos: fixedPhotos,
        profileComplete: profileCompleteness,
      },
    });
  } catch (error) {
    console.error("🔥 [deletePhoto] ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while deleting photo.",
    });
  }
};
