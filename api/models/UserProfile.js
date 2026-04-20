import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const profileSchema = new Schema(
  {
    // ===== CORE IDENTITY =====
    phoneNumber: { type: String, required: true, unique: true },

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
    username: { type: String, default: "" },
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
profileSchema.index({ onboardingStage: 1, gender: 1, dateOfBirth: 1, updatedAt: -1 });
profileSchema.index({ onboardingStage: 1, updatedAt: -1 });
profileSchema.index({ gender: 1, updatedAt: -1 });
profileSchema.index({ gender: 1, dateOfBirth: 1, updatedAt: -1 });

const UserProfile = model("UserProfile", profileSchema);

export default UserProfile;
