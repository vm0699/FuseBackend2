import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Gift order state machine (Phase 2 MVP):
 *
 *   CREATED -> PAID -> ADMIN_REVIEW -> APPROVED -> PROCESSING -> FULFILLED -> DELIVERED
 *   any (pre-fulfilment) -> CANCELLED
 *   recipient decline after payment -> REFUND_REQUIRED -> REFUNDED
 *
 * Terminal : DELIVERED, CANCELLED, REFUNDED
 * Active    : CREATED, PAID, ADMIN_REVIEW, APPROVED, PROCESSING, FULFILLED, REFUND_REQUIRED
 */
export const GIFT_ORDER_STATUSES = [
  "CREATED",
  "PAID",
  "ADMIN_REVIEW",
  "APPROVED",
  "PROCESSING",
  "FULFILLED",
  "DELIVERED",
  "CANCELLED",
  "REFUND_REQUIRED",
  "REFUNDED",
];

export const GIFT_ORDER_TERMINAL_STATUSES = [
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
];

export const GIFT_ORDER_ACTIVE_STATUSES = [
  "CREATED",
  "PAID",
  "ADMIN_REVIEW",
  "APPROVED",
  "PROCESSING",
  "FULFILLED",
  "REFUND_REQUIRED",
];

const GiftOrderSchema = new Schema(
  {
    chatId: {
      type: Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },

    intentId: {
      type: Schema.Types.ObjectId,
      ref: "GiftIntent",
      default: null,
      unique: true,
      sparse: true,
    },

    paymentId: {
      type: Schema.Types.ObjectId,
      ref: "GiftPayment",
      default: null,
    },

    // Human-readable support/tracking code, e.g. FUSE-G-AB12CD
    orderCode: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    senderId: {
      type: Schema.Types.ObjectId,
      ref: "UserProfile",
      required: true,
    },

    recipientId: {
      type: Schema.Types.ObjectId,
      ref: "UserProfile",
      required: true,
    },

    tier: {
      type: String,
      enum: ["LOW", "MID", null],
      default: null,
    },

    catalogItemId: {
      type: Schema.Types.ObjectId,
      ref: "GiftCatalogItem",
      default: null,
    },

    items: [
      {
        itemId: String,
        name: String,
        quantity: Number,
        price: Number,
        source: {
          type: String,
          enum: ["FUSE_MANUAL", "EXTERNAL_VENDOR"],
          default: "FUSE_MANUAL",
        },
      },
    ],

    source: {
      type: String,
      enum: ["FUSE_MANUAL", "EXTERNAL_VENDOR"],
      default: "FUSE_MANUAL",
    },

    totalAmount: {
      type: Number,
      required: true,
    },

    senderPaidAmount: {
      type: Number,
      default: 0,
    },

    currency: {
      type: String,
      default: "INR",
    },

    // Platform economics
    platformFee: {
      type: Number,
      default: 0,
    },
    deliveryFee: {
      type: Number,
      default: 0,
    },
    vendorCost: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: GIFT_ORDER_STATUSES,
      default: "CREATED",
    },

    // Append-only audit of every status change
    statusHistory: [
      {
        status: { type: String, enum: GIFT_ORDER_STATUSES },
        action: { type: String, default: "" },
        byUserId: {
          type: Schema.Types.ObjectId,
          ref: "UserProfile",
          default: null,
        },
        byRole: {
          type: String,
          enum: ["ADMIN", "RECIPIENT", "SENDER", "SYSTEM"],
          default: "SYSTEM",
        },
        note: { type: String, default: "" },
        at: { type: Date, default: Date.now },
      },
    ],

    // Frozen FULL delivery snapshot. Never exposed wholesale to the sender —
    // serializers strip it based on viewer role.
    deliverySnapshot: {
      name: String,
      phone: String,
      line1: String,
      line2: String,
      city: String,
      state: String,
      pincode: String,
      landmark: String,
      label: String,
    },

    // Defensive guard: true when the recipient had no usable address at
    // payment time. Order is held in ADMIN_REVIEW until resolved.
    addressMissing: {
      type: Boolean,
      default: false,
    },

    trackingUrl: {
      type: String,
      default: null,
    },
    vendorOrderId: {
      type: String,
      default: null,
    },

    // Admin-only internal notes
    adminNotes: {
      type: String,
      default: "",
    },

    // Lifecycle timestamps
    approvedAt: Date,
    processingAt: Date,
    fulfilledAt: Date,
    dispatchedAt: Date,
    deliveredAt: Date,
    cancelledAt: Date,
    refundRequiredAt: Date,
    refundedAt: Date,

    note: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

GiftOrderSchema.index({ chatId: 1, status: 1, createdAt: -1 });
GiftOrderSchema.index({ senderId: 1, createdAt: -1 });
GiftOrderSchema.index({ recipientId: 1, createdAt: -1 });
GiftOrderSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("GiftOrder", GiftOrderSchema);
