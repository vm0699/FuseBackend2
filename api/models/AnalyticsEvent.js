import mongoose from "mongoose";

/**
 * Lightweight analytics event log for Fuse Explore funnels.
 * North-star metric: match-to-date conversion.
 * Store raw events now; build aggregation/dashboard later.
 */
const analyticsEventSchema = new mongoose.Schema(
  {
    event: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "UserProfile", index: true },
    sessionId: { type: String },
    properties: { type: mongoose.Schema.Types.Mixed, default: {} },
    city: { type: String, default: "Chennai" },
    platform: { type: String, enum: ["ios", "android", "web", "server"], default: "server" },
  },
  {
    timestamps: true,
    collection: "analyticsevents",
  }
);

analyticsEventSchema.index({ event: 1, createdAt: -1 });
analyticsEventSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model("AnalyticsEvent", analyticsEventSchema);
