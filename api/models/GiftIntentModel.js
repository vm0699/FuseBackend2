import mongoose from "mongoose";

/**
 * GiftIntent — Phase 2 MVP
 *
 * Represents a sender's intent to send a single platform-approved catalog gift
 * inside an accepted chat. Payment-first: there is no recipient consent step.
 *
 * tier   : LOW | MID only (HIGH is reserved for future Fuse Experiences).
 * status : CREATED -> PAID (or CANCELLED).
 *
 * Pricing is always computed on the backend from the catalog snapshot; the
 * client never supplies prices.
 */
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
      enum: ["LOW", "MID"],
      required: true,
    },

    // Source catalog item this intent was built from
    catalogItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GiftCatalogItem",
      default: null,
    },

    // Frozen snapshot of the catalog item at intent-creation time.
    // This is the source of truth for amount; client input is ignored.
    catalogSnapshot: {
      name: { type: String, default: "" },
      description: { type: String, default: "" },
      tier: { type: String, enum: ["LOW", "MID"], default: "LOW" },
      imageUrl: { type: String, default: "" },
      category: { type: String, default: "" },
      occasion: { type: String, default: "" },
      price: { type: Number, default: 0 },
      platformFee: { type: Number, default: 0 },
      deliveryFee: { type: Number, default: 0 },
      finalAmount: { type: Number, default: 0 },
    },

    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },

    // Legacy line-items array kept for backward-compat reads; new flow uses
    // catalogSnapshot. Populated as a single derived line for convenience.
    items: [
      {
        itemId: String,
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
      enum: ["CREATED", "PAID", "CANCELLED"],
      default: "CREATED",
    },

    // Snapshot of the gifting rules in force when this intent was created.
    // MVP forces both consent/payment requirements to false.
    rulesSnapshot: {
      lowLimit: Number,
      midLimit: Number,
      requiresRecipientConsent: { type: Boolean, default: false },
      requiresRecipientPayment: { type: Boolean, default: false },
    },

    // 💳 Sender-paid payment tracking (sender pays the full amount)
    senderPaidAmount: {
      type: Number,
      default: 0,
    },
    senderPaidAt: Date,
  },
  { timestamps: true }
);

GiftIntentSchema.index({ chatId: 1, status: 1, createdAt: -1 });
GiftIntentSchema.index({ senderId: 1, createdAt: -1 });

export default mongoose.model("GiftIntent", GiftIntentSchema);
