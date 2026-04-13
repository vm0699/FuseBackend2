import mongoose from "mongoose";

const ChatSchema = new mongoose.Schema(
  {
    // Existing fields — DO NOT CHANGE
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserProfile",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserProfile",
      required: true,
    },

    twilioChatChannelSid: {
      type: String,
      unique: true, // Existing SID reference
    },
    twilioChannelSid: {
      type: String, // Optional alias for channel SID
    },

    pairKey: {
      type: String, // normalized "userA|userB"
      required: true,
    },

    // Existing message storage (kept as-is)
    messages: [
      {
        sender: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "UserProfile",
        },
        message: {
          type: String,
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Existing + extended lifecycle
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "closed"],
      default: "pending",
    },

    // 🔹 ADDITION (non-breaking)
    // Neutral participants array for accepted chats & future logic
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "UserProfile",
      },
    ],
  },
  {
    // 🔹 ADDITION (non-breaking)
    // Needed for chat list ordering, debugging, lifecycle tracking
    timestamps: true, // createdAt, updatedAt
  }
);

/**
 * IMPORTANT INDEX (already conceptually present, now enforced clearly)
 *
 * This ensures:
 * - Only ONE active chat per pairKey when status is pending or accepted
 * - Allows NEW chat creation when last chat is rejected or closed
 *
 * Controllers must handle reuse logic carefully.
 */
ChatSchema.index(
  { pairKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["pending", "accepted"] },
    },
  }
);

export default mongoose.model("Chat", ChatSchema);
