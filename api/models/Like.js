import mongoose from "mongoose";

const likeSchema = new mongoose.Schema({
  likerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "UserProfile",
    required: true,
  },
  likedUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "UserProfile",
    required: true,
  },
  status: {
    type: String,
    enum: ["pending", "matched", "closed"],
    default: "pending",
  },
  // Attribution only (Explore Iteration 2) — never read by swipeStateMachine.
  source: {
    type: String,
    enum: ["swipe", "event_wave"],
    default: "swipe",
  },
  eventId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Event",
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// prevent duplicate likes for same pair
likeSchema.index({ likerId: 1, likedUserId: 1 }, { unique: true });

export default mongoose.model("Like", likeSchema);
