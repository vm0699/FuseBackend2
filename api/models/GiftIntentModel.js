import mongoose from "mongoose";

const GiftIntentSchema = new mongoose.Schema(
  {
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },

    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserProfile",
      required: true,
    },

    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserProfile",
      required: true,
    },

    tier: {
      type: String,
      enum: ["LOW", "MID", "HIGH"],
      required: true,
    },

    items: [
      {
        itemId: String, // internal Fuse ID
        name: String,
        quantity: Number,
        price: Number,
        source: {
          type: String,
          enum: ["FUSE_MANUAL"],
          default: "FUSE_MANUAL",
        },
      },
    ],

    totalAmount: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: [
        "CREATED",            // low-tier, no consent yet
        "AWAITING_RECIPIENT", // mid/high → waiting consent
        "ACCEPTED",           // consent given
        "REJECTED",
        "EXPIRED",
        "PAID",
        "CANCELLED",
      ],
      default: "CREATED",
    },

    expiresAt: Date,

    rulesSnapshot: {
      lowLimit: Number,
      midLimit: Number,
      requiresRecipientConsent: Boolean,
      requiresRecipientPayment: Boolean,
    },

    // 💳 Single-payer payment tracking
    senderPaidAmount: {
      type: Number,
      default: 0,
    },
    senderPaidAt: Date,

    // kept only for future multi-pay if ever needed
    recipientPaidAmount: {
      type: Number,
      default: 0,
    },
    recipientPaidAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model("GiftIntent", GiftIntentSchema);
