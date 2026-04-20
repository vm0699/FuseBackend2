import mongoose from "mongoose";

const ChatSchema = new mongoose.Schema(
  {
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
      unique: true,
    },
    twilioChannelSid: {
      type: String,
    },
    twilioMembersInitialized: {
      type: Boolean,
      default: false,
    },
    pairKey: {
      type: String,
      required: true,
    },
    lastMessageSummary: {
      type: String,
      default: null,
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
    lastMessageSenderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserProfile",
      default: null,
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
    },
    // Legacy embedded storage is kept only as a migration-safe fallback.
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
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "closed"],
      default: "pending",
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "UserProfile",
      },
    ],
  },
  {
    timestamps: true,
  }
);

ChatSchema.index(
  { pairKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["pending", "accepted"] },
    },
  }
);

ChatSchema.index({ senderId: 1, status: 1, lastActivityAt: -1, _id: -1 });
ChatSchema.index({ receiverId: 1, status: 1, lastActivityAt: -1, _id: -1 });
ChatSchema.index({ pairKey: 1 });

export default mongoose.model("Chat", ChatSchema);
