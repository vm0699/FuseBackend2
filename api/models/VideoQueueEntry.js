import mongoose from "mongoose";

const videoQueueEntrySchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    socketId: {
      type: String,
      default: "",
    },
    interests: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ["waiting", "matched", "left"],
      default: "waiting",
      index: true,
    },
    matchedUserId: {
      type: String,
      default: null,
    },
    roomId: {
      type: String,
      default: null,
    },
    matchedInterest: {
      type: String,
      default: null,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    matchedAt: {
      type: Date,
      default: null,
    },
    disconnectedAt: {
      type: Date,
      default: null,
    },
    leftReason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

videoQueueEntrySchema.index({ status: 1, joinedAt: 1 });

export default mongoose.model("VideoQueueEntry", videoQueueEntrySchema);
