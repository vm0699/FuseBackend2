import mongoose from "mongoose";

const DeviceTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserProfile",
      required: true,
      index: true,
    },
    pushToken: {
      type: String,
      required: true,
      trim: true,
    },
    provider: {
      type: String,
      enum: ["EXPO", "FCM", "ONESIGNAL"],
      default: "EXPO",
      index: true,
    },
    platform: {
      type: String,
      enum: ["ios", "android", "web", "unknown"],
      default: "unknown",
    },
    deviceId: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
    invalidatedAt: {
      type: Date,
      default: null,
    },
    invalidReason: {
      type: String,
      default: "",
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

DeviceTokenSchema.index(
  { provider: 1, pushToken: 1 },
  { unique: true, name: "uniq_provider_push_token" }
);

DeviceTokenSchema.index(
  { userId: 1, provider: 1, deviceId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      deviceId: { $type: "string", $ne: "" },
    },
    name: "uniq_user_provider_device",
  }
);

export default mongoose.model("DeviceToken", DeviceTokenSchema);
