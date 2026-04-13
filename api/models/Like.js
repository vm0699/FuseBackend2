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
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// prevent duplicate likes for same pair
likeSchema.index({ likerId: 1, likedUserId: 1 }, { unique: true });

export default mongoose.model("Like", likeSchema);
