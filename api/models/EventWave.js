import mongoose from "mongoose";

/**
 * Event-scoped "wave" — a lightweight like sent between two attendees of the
 * same Event Circle. Deliberately NOT stored in Like: Like has a global unique
 * {likerId, likedUserId} index and a pending/matched/closed state machine that
 * a per-event, capped, re-waveable interaction would collide with.
 */
const eventWaveSchema = new mongoose.Schema(
  {
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: "UserProfile", required: true },
    toUserId: { type: mongoose.Schema.Types.ObjectId, ref: "UserProfile", required: true },
    status: {
      type: String,
      enum: ["PENDING", "MATCHED", "DECLINED", "EXPIRED"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

eventWaveSchema.index({ eventId: 1, fromUserId: 1, toUserId: 1 }, { unique: true });
eventWaveSchema.index({ eventId: 1, toUserId: 1, status: 1 });
eventWaveSchema.index({ eventId: 1, fromUserId: 1 });

export default mongoose.model("EventWave", eventWaveSchema);
