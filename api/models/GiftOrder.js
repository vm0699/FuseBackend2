import mongoose from "mongoose";

const { Schema } = mongoose;

const GiftOrderSchema = new Schema(
  {
    chatId: {
      type: Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
    },

    // May be null for legacy/manual orders
    intentId: {
      type: Schema.Types.ObjectId,
      ref: "GiftIntent",
      default: null,
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

    // Mirrors GiftIntent tier when available
    tier: {
      type: String,
      enum: ["LOW", "MID", "HIGH", null],
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

    // Who actually paid what (from GiftPayment)
    senderPaidAmount: {
      type: Number,
      default: 0,
    },
    recipientPaidAmount: {
      type: Number,
      default: 0,
    },

    currency: {
      type: String,
      default: "INR",
    },

    // Platform economics (we can refine later)
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

    // Fulfilment lifecycle
    status: {
      type: String,
      enum: [
        "CREATED",     // payment done, yet to process
        "PROCESSING",  // vendor / ops picked it up
        "DISPATCHED",  // out for delivery
        "DELIVERED",   // reached
        "FAILED",      // delivery failed
        "CANCELLED",
      ],
      default: "CREATED",
    },

    // Frozen delivery snapshot (FULL, but we won’t expose all of it in APIs)
    deliverySnapshot: {
      name: String,
      phone: String,
      line1: String,
      line2: String,
      city: String,
      state: String,
      pincode: String,
      landmark: String,
      label: String, // e.g. "Home", "Work"
    },

    // Tracking info (can be used to show in UI)
    trackingUrl: {
      type: String,
      default: null,
    },
    vendorOrderId: {
      type: String,
      default: null,
    },

    // Lifecycle timestamps
    dispatchedAt: Date,
    deliveredAt: Date,
    cancelledAt: Date,

    note: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

export default mongoose.model("GiftOrder", GiftOrderSchema);
