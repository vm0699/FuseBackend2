import UserProfile from '../models/UserProfile.js';
import Like from '../models/Like.js';
import Chat from '../models/ChatModel.js';
import client from "../config/twilio.js";
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';

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
if (options?.username) existingUser.username = options.username;
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
const EARTH_RADIUS_KM = 6371;
const DEG_TO_RAD = Math.PI / 180;

function parseDiscoveryNumber(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDiscoveryFilters(rawFilters, fallbackInterests = []) {
  const safeFilters =
    rawFilters && typeof rawFilters === "object" ? rawFilters : {};
  const parsedDistance = Number(safeFilters.distanceKm);
  const normalizedInterests = Array.isArray(safeFilters.interests)
    ? safeFilters.interests.filter(
        (value) => typeof value === "string" && value.trim()
      )
    : fallbackInterests;

  return {
    ageRange:
      safeFilters.ageRange?.min && safeFilters.ageRange?.max
        ? {
            min: Math.max(Number(safeFilters.ageRange.min), 18),
            max: Math.max(
              Number(safeFilters.ageRange.max),
              Number(safeFilters.ageRange.min)
            ),
          }
        : null,
    ageFlex: Boolean(safeFilters.ageFlex),
    distanceKm:
      Number.isFinite(parsedDistance) && parsedDistance > 0
        ? parsedDistance
        : null,
    distanceFlex: Boolean(safeFilters.distanceFlex),
    interests: normalizedInterests,
  };
}

function getPreferredGender(gender) {
  if (gender === "Man") return "Woman";
  if (gender === "Woman") return "Man";
  return null;
}

function buildDobRange(ageRange) {
  if (!ageRange?.min || !ageRange?.max) return null;

  const today = new Date();
  const minDOB = new Date(
    today.getFullYear() - ageRange.max,
    today.getMonth(),
    today.getDate()
  );
  const maxDOB = new Date(
    today.getFullYear() - ageRange.min,
    today.getMonth(),
    today.getDate()
  );

  return {
    $gte: minDOB.toISOString().slice(0, 10),
    $lte: maxDOB.toISOString().slice(0, 10),
  };
}

function buildBaseDiscoveryMatch({
  requesterId,
  preferredGender,
  swipedUserIds,
  excludeSwiped,
  dobRange,
  extraExcludedIds = [],
}) {
  const excludedIds = [
    ...(excludeSwiped ? swipedUserIds : []),
    ...extraExcludedIds,
  ];

  const idMatch = { $ne: requesterId };
  if (excludedIds.length) {
    idMatch.$nin = excludedIds;
  }

  const match = {
    _id: idMatch,
    $or: [
      { onboardingStage: "COMPLETE" },
      { onboardingStage: { $exists: false } },
      { onboardingStage: null },
      { onboardingStage: "" },
    ],
  };

  if (preferredGender) {
    match.gender = preferredGender;
  }

  if (dobRange) {
    match.dateOfBirth = dobRange;
  }

  return match;
}

function buildDistanceKmExpression(latitude, longitude) {
  const requesterLatRad = latitude * DEG_TO_RAD;
  const requesterLngRad = longitude * DEG_TO_RAD;
  const candidateLatRad = {
    $multiply: [{ $ifNull: ["$location.latitude", 0] }, DEG_TO_RAD],
  };
  const candidateLngRad = {
    $multiply: [{ $ifNull: ["$location.longitude", 0] }, DEG_TO_RAD],
  };

  const acosInput = {
    $add: [
      {
        $multiply: [Math.sin(requesterLatRad), { $sin: candidateLatRad }],
      },
      {
        $multiply: [
          Math.cos(requesterLatRad),
          { $cos: candidateLatRad },
          { $cos: { $subtract: [candidateLngRad, requesterLngRad] } },
        ],
      },
    ],
  };

  return {
    $cond: [
      {
        $and: [
          { $ne: ["$location.latitude", null] },
          { $ne: ["$location.longitude", null] },
        ],
      },
      {
        $multiply: [
          EARTH_RADIUS_KM,
          {
            $acos: {
              $min: [1, { $max: [-1, acosInput] }],
            },
          },
        ],
      },
      null,
    ],
  };
}

async function executeDiscoveryQuery({
  requester,
  preferredGender,
  filters,
  page,
  limit,
  excludeSwiped,
}) {
  const swipedUserIds =
    requester.swipedUserIds?.map((value) => value.toString()) || [];
  const requesterLatitude = requester.location?.latitude;
  const requesterLongitude = requester.location?.longitude;
  const hasRequesterLocation =
    typeof requesterLatitude === "number" &&
    typeof requesterLongitude === "number";
  const discoveryInterests = Array.isArray(filters.interests)
    ? filters.interests
    : [];
  const expandedAgeRange =
    filters.ageRange && filters.ageFlex
      ? {
          min: Math.max(18, filters.ageRange.min - 2),
          max: filters.ageRange.max + 2,
        }
      : null;
  const targetCount = page * limit;

  const runDiscoveryVariant = async ({
    ageRange,
    requireSharedInterests,
    enforceDistanceBoundary,
    extraExcludedIds,
    fetchLimit,
  }) => {
    const baseMatch = buildBaseDiscoveryMatch({
      requesterId: requester._id,
      preferredGender,
      swipedUserIds,
      excludeSwiped,
      dobRange: buildDobRange(ageRange),
      extraExcludedIds,
    });

    const pipeline = [
      { $match: baseMatch },
      {
        $addFields: {
          sharedInterestCount: {
            $size: {
              $setIntersection: [
                { $ifNull: ["$interests", []] },
                discoveryInterests,
              ],
            },
          },
          hasLocation: {
            $and: [
              { $ne: ["$location.latitude", null] },
              { $ne: ["$location.longitude", null] },
            ],
          },
        },
      },
      {
        $addFields: {
          hasSharedInterests: { $gt: ["$sharedInterestCount", 0] },
          distanceKm: hasRequesterLocation
            ? buildDistanceKmExpression(requesterLatitude, requesterLongitude)
            : null,
        },
      },
    ];

    if (requireSharedInterests) {
      pipeline.push({
        $match: { hasSharedInterests: true },
      });
    }

    if (enforceDistanceBoundary) {
      pipeline.push({
        $match: {
          distanceKm: { $ne: null, $lte: filters.distanceKm },
        },
      });
    }

    pipeline.push(
      {
        $addFields: {
          withinDistance:
            hasRequesterLocation && filters.distanceKm
              ? {
                  $and: [
                    { $ne: ["$distanceKm", null] },
                    { $lte: ["$distanceKm", filters.distanceKm] },
                  ],
                }
              : false,
        },
      },
      {
        $addFields: {
          discoveryBucket: {
            $switch: {
              branches: [
                {
                  case: {
                    $and: [
                      "$hasSharedInterests",
                      {
                        $cond: [
                          hasRequesterLocation && Boolean(filters.distanceKm),
                          "$withinDistance",
                          true,
                        ],
                      },
                    ],
                  },
                  then: 0,
                },
                {
                  case: "$hasSharedInterests",
                  then: 1,
                },
                {
                  case:
                    hasRequesterLocation && Boolean(filters.distanceKm)
                      ? "$withinDistance"
                      : false,
                  then: 2,
                },
              ],
              default: 3,
            },
          },
          discoveryScore: {
            $add: [
              { $cond: ["$hasSharedInterests", 1000, 0] },
              { $cond: ["$withinDistance", 100, 0] },
              { $min: ["$sharedInterestCount", 25] },
              { $cond: ["$hasLocation", 10, 0] },
            ],
          },
        },
      },
      {
        $sort: {
          discoveryBucket: 1,
          discoveryScore: -1,
          sharedInterestCount: -1,
          withinDistance: -1,
          updatedAt: -1,
          _id: -1,
        },
      },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [{ $limit: fetchLimit }],
        },
      },
    );

    const [result] = await UserProfile.aggregate(pipeline);
    const total = result?.metadata?.[0]?.total || 0;
    const profiles = result?.data || [];

    return {
      profiles,
      total,
    };
  };

  const variants = [];

  if (filters.ageRange && discoveryInterests.length) {
    variants.push({
      ageRange: filters.ageRange,
      requireSharedInterests: true,
      enforceDistanceBoundary: Boolean(filters.distanceKm) && hasRequesterLocation,
    });
  }

  if (filters.ageRange) {
    variants.push({
      ageRange: filters.ageRange,
      requireSharedInterests: false,
      enforceDistanceBoundary: Boolean(filters.distanceKm) && hasRequesterLocation,
    });

    variants.push({
      ageRange: filters.ageRange,
      requireSharedInterests: false,
      enforceDistanceBoundary: false,
    });
  }

  if (expandedAgeRange && discoveryInterests.length) {
    variants.push({
      ageRange: expandedAgeRange,
      requireSharedInterests: true,
      enforceDistanceBoundary: Boolean(filters.distanceKm) && hasRequesterLocation,
    });
  }

  if (expandedAgeRange) {
    variants.push({
      ageRange: expandedAgeRange,
      requireSharedInterests: false,
      enforceDistanceBoundary: Boolean(filters.distanceKm) && hasRequesterLocation,
    });

    variants.push({
      ageRange: expandedAgeRange,
      requireSharedInterests: false,
      enforceDistanceBoundary: false,
    });
  }

  if (discoveryInterests.length) {
    variants.push({
      ageRange: null,
      requireSharedInterests: true,
      enforceDistanceBoundary: Boolean(filters.distanceKm) && hasRequesterLocation,
    });

    variants.push({
      ageRange: null,
      requireSharedInterests: true,
      enforceDistanceBoundary: false,
    });
  }

  if (Boolean(filters.distanceKm) && hasRequesterLocation) {
    variants.push({
      ageRange: null,
      requireSharedInterests: false,
      enforceDistanceBoundary: true,
    });
  }

  variants.push({
    ageRange: null,
    requireSharedInterests: false,
    enforceDistanceBoundary: false,
  });

  const combinedProfiles = [];
  const addedIds = new Set();
  let totalAvailable = 0;
  const tried = new Set();

  for (const variant of variants) {
    const variantKey = JSON.stringify(variant);
    if (tried.has(variantKey)) continue;
    tried.add(variantKey);

    const result = await runDiscoveryVariant({
      ...variant,
      extraExcludedIds: Array.from(addedIds),
      fetchLimit: targetCount,
    });

    totalAvailable += result.total;

    for (const profile of result.profiles) {
      const profileId = profile?._id?.toString();
      if (!profileId || addedIds.has(profileId)) continue;
      addedIds.add(profileId);
      combinedProfiles.push(profile);
    }

    if (combinedProfiles.length >= targetCount) {
      break;
    }
  }

  const skip = (page - 1) * limit;
  const pagedProfiles = combinedProfiles.slice(skip, skip + limit);

  return {
    profiles: pagedProfiles,
    total: totalAvailable,
    page,
    limit,
    hasMore: totalAvailable > skip + pagedProfiles.length,
  };
}

export const getFilteredProfiles = async (req, res) => {
  try {
    console.log("[FilteredProfiles] Incoming request");
    console.log("Method:", req.method);

    if (!req.user) {
      console.log("No req.user - unauthorized");
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const requester = await UserProfile.findById(req.user.id).lean();
    if (!requester) {
      console.log("Requester not found in DB");
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const filters = normalizeDiscoveryFilters(
      req.body?.filters,
      requester.interests || []
    );
    const page = parseDiscoveryNumber(req.body?.page || req.query?.page, 1);
    const limit = Math.min(
      parseDiscoveryNumber(
        req.body?.limit || req.query?.limit,
        DEFAULT_DISCOVERY_LIMIT
      ),
      MAX_DISCOVERY_LIMIT
    );
    const preferredGender = getPreferredGender(requester.gender);

    console.log("User:", {
      id: requester._id.toString(),
      gender: requester.gender,
      preferredGender,
    });
    console.log("Filters received:", filters);
    console.log("Discovery page:", page, "limit:", limit);

    let discoveryResult = await executeDiscoveryQuery({
      requester,
      preferredGender,
      filters,
      page,
      limit,
      excludeSwiped: true,
    });

    let recycled = false;

    if (!discoveryResult.total) {
      recycled = true;
      console.log("Discovery exhausted; recycling swiped profiles");
      discoveryResult = await executeDiscoveryQuery({
        requester,
        preferredGender,
        filters,
        page,
        limit,
        excludeSwiped: false,
      });
    }

    console.log("Returning profiles:", discoveryResult.profiles.length);

    return res.status(200).json({
      success: true,
      profiles: mapProfiles(discoveryResult.profiles),
      pagination: {
        page: discoveryResult.page,
        limit: discoveryResult.limit,
        total: discoveryResult.total,
        hasMore: discoveryResult.hasMore,
        recycled,
      },
    });
  } catch (error) {
    console.error("FilteredProfiles error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch filtered profiles",
    });
  }
};

function mapProfiles(users) {
  return users.map((user) => ({
    _id: user._id,
    name: user.name,
    username: user.username,
    dateOfBirth: user.dateOfBirth,
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
    sharedInterestCount: user.sharedInterestCount || 0,
    withinDistance: Boolean(user.withinDistance),
    distanceKm:
      typeof user.distanceKm === "number"
        ? Number(user.distanceKm.toFixed(1))
        : null,
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

        let chat = await Chat.findOne({ pairKey });

        if (!chat) {
          console.log("Creating NEW chat for match");
          chat = new Chat({
            senderId: loggedInUserId,
            receiverId: swipedUserId,
            status: "accepted",
            messages: [],
            pairKey,
          });
        } else {
          console.log("Reusing EXISTING chat");
          chat.status = "accepted";
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




export const uploadPhotos = async (req, res) => {
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

    for (const fileUrl of pendingFileDeletes) {
      deleteLocalUploadIfPresent(fileUrl);
    }

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
    return res.status(500).json({
      success: false,
      message: 'An error occurred while uploading photos.',
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

    for (const fileUrl of pendingFileDeletes) {
      deleteLocalUploadIfPresent(fileUrl);
    }

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
    return res.status(500).json({
      success: false,
      message: "Internal server error while updating profile.",
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
