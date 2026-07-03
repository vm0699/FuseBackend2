import mongoose from "mongoose";

/**
 * GiftPayment — Phase 2 MVP
 *
 * Sender-paid only. `mode` controls whether this is a dev PLACEHOLDER payment
 * or a real RAZORPAY payment (driven by GIFT_PAYMENT_MODE). `idempotencyKey`
 * guarantees a retry/double-tap can never create a second payment for the same
 * intent attempt.
 */
const GiftPaymentSchema = new mongoose.Schema(
  {
    giftIntentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GiftIntent",
      required: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserProfile",
      required: true,
    },

    role: {
      type: String,
      enum: ["SENDER", "RECIPIENT"],
      default: "SENDER",
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    currency: {
      type: String,
      default: "INR",
    },

    // PLACEHOLDER (dev) or RAZORPAY (real). Set from GIFT_PAYMENT_MODE.
    mode: {
      type: String,
      enum: ["PLACEHOLDER", "RAZORPAY"],
      default: "PLACEHOLDER",
    },

    provider: {
      type: String,
      default: "RAZORPAY",
    },

    providerOrderId: {
      type: String,
    },

    providerPaymentId: {
      type: String,
    },

    // Idempotency guard: unique per payment attempt. A retry reuses the record.
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
    },

    status: {
      type: String,
      enum: ["INITIATED", "PAID", "FAILED", "REFUNDED"],
      default: "INITIATED",
    },

    verifiedAt: Date,

    failureReason: {
      type: String,
    },

    meta: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

GiftPaymentSchema.index({ giftIntentId: 1, status: 1 });

export default mongoose.model("GiftPayment", GiftPaymentSchema);
