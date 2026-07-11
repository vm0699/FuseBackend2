import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const profileSchema = new Schema(
  {
    // ===== CORE IDENTITY =====
    phoneNumber: { type: String, required: true, unique: true },

    // Optional secondary login identity — linked to an existing phone account
    // via Settings, used only for the "log in with email" OTP shortcut.
    email: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
      sparse: true,
      unique: true,
    },

    // ===== ONBOARDING CHECKPOINT TRACKER (2.1 CORE) =====
    onboardingStage: {
      type: String,
      enum: [
        "PHONE_VERIFIED",
        "INTRO_DONE",
        "PROFILE_SETUP_DONE",
        "LOCATION_DONE", // ✅ ADDED
        "DETAILS_DONE",
        "PROMPTS_DONE",
        "PHOTOS_DONE",
        "COMPLETE",
      ],
      default: "PHONE_VERIFIED",
    },

    // ===== BASIC PROFILE =====
    name: { type: String, default: "" },
    username: {
      type: String,
      default: null,
      trim: true,
      lowercase: true,
    },
    dateOfBirth: { type: String, default: "" },
    gender: { type: String, default: "" },
    height: { type: String, default: "" },

    interests: { type: [String], default: [] },
    values: { type: [String], default: [] },

    // ===== PROMPTS =====
    prompts: {
      type: [
        {
          question: String,
          answer: String,
        },
      ],
      default: [],
    },

    // ===== PHOTOS =====
    photos: { type: [String], default: [] },

    // ===== LOCATION =====
    location: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },

    locationGeo: {
      type: {
        type: String,
        enum: ["Point"],
        default: null,
      },
      coordinates: {
        type: [Number],
        default: null,
      },
    },

    deliveryAddress: {
  name: { type: String, default: "" },
  phone: { type: String, default: "" }, // auto-filled from user phone
  line1: { type: String, default: "" },
  line2: { type: String, default: "" },
  landmark: { type: String, default: "" },
  city: { type: String, default: "" },
  pincode: { type: String, default: "" }
  },

    // ===== EDITABLE PROFILE FIELDS =====
    pronouns: { type: String, default: "" },
    sexuality: { type: String, default: "" },
    work: { type: String, default: "" },
    jobTitle: { type: String, default: "" },
    college: { type: String, default: "" },
    educationLevel: { type: String, default: "" },
    religion: { type: String, default: "" },
    homeTown: { type: String, default: "" },
    politics: { type: String, default: "" },
    languages: { type: [String], default: [] },
    datingIntentions: { type: String, default: "" },
    relationshipType: { type: String, default: "" },
    ethnicity: { type: String, default: "" },
    children: { type: String, default: "" },
    familyPlans: { type: String, default: "" },
    covidVaccine: { type: String, default: "" },
    pets: { type: String, default: "" },
    zodiacSign: { type: String, default: "" },
    drinking: { type: String, default: "" },
    smoking: { type: String, default: "" },
    marijuana: { type: String, default: "" },
    drugs: { type: String, default: "" },

    // ===== SAFETY / COMMERCE PREFERENCES =====
    safetyPreferences: {
      allowGifts: { type: Boolean, default: true },
      allowDateInvites: { type: Boolean, default: true },
    },

    // ===== EXPLORE EVENT STATS (Iteration 2 — Event Circles) =====
    eventStats: {
      checkInCount: { type: Number, default: 0 },
      currentStreak: { type: Number, default: 0 },
      lastCheckInAt: { type: Date, default: null },
      badges: { type: [String], default: [] },
    },

    // ===== DISCOVERY PREFERENCES =====
    preferredGender: { type: [String], default: [] },

    // Throttled timestamp of last authenticated activity — used for discovery ranking
    lastActiveAt: { type: Date, default: null },

    // Persisted filter preferences — saved from FilterScreen, synced across devices
    discoveryPreferences: {
      ageRange: {
        min: { type: Number, default: 18 },
        max: { type: Number, default: 45 },
      },
      ageFlex: { type: Boolean, default: true },
      distanceKm: { type: Number, default: 50 },
      distanceFlex: { type: Boolean, default: true },
      interests: { type: [String], default: [] },
      datingIntentions: { type: [String], default: [] },
      religion: { type: [String], default: [] },
      ethnicity: { type: [String], default: [] },
      drinking: { type: [String], default: [] },
      smoking: { type: [String], default: [] },
      activeOnly: { type: Boolean, default: false },
      eventScope: { type: String, enum: ["EVERYONE", "EVENT_GOERS", "MY_CIRCLES"], default: "EVERYONE" },
    },

    // ===== MATCHING & SWIPE TRACKING =====
    swipedUserIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "UserProfile",
      default: [],
    },

    swipedRight: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "UserProfile",
      default: [],
    },

    swipedLeft: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "UserProfile",
      default: [],
    },

    matches: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "UserProfile",
      default: [],
    },
  },
  { timestamps: true }
);

profileSchema.pre("save", function syncLocationGeo(next) {
  const latitude = this.location?.latitude;
  const longitude = this.location?.longitude;

  if (typeof latitude === "number" && typeof longitude === "number") {
    this.locationGeo = {
      type: "Point",
      coordinates: [longitude, latitude],
    };
  } else {
    this.locationGeo = null;
  }

  next();
});

profileSchema.index({ locationGeo: "2dsphere" });
profileSchema.index(
  { username: 1 },
  {
    unique: true,
    partialFilterExpression: {
      username: { $type: "string", $ne: "" },
    },
  }
);
profileSchema.index({ onboardingStage: 1, gender: 1, dateOfBirth: 1, updatedAt: -1 });
profileSchema.index({ onboardingStage: 1, updatedAt: -1 });
profileSchema.index({ gender: 1, updatedAt: -1 });
profileSchema.index({ gender: 1, dateOfBirth: 1, updatedAt: -1 });
// Discovery ranking indices
profileSchema.index({ lastActiveAt: -1, gender: 1 });
profileSchema.index({ interests: 1 });

const UserProfile = model("UserProfile", profileSchema);

export default UserProfile;
