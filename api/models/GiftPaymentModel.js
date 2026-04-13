import mongoose from "mongoose";

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

    // Payment gateway info (Razorpay or whatever you plug in later)
    provider: {
      type: String,
      default: "RAZORPAY", // can change later if needed
    },

    providerOrderId: {
      type: String,
    },

    providerPaymentId: {
      type: String,
    },

    status: {
      type: String,
      enum: ["INITIATED", "PAID", "FAILED", "REFUNDED"],
      default: "INITIATED",
    },

    failureReason: {
      type: String,
    },

    meta: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

export default mongoose.model("GiftPayment", GiftPaymentSchema);
