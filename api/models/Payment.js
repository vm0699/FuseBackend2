import mongoose from "mongoose";

/**
 * Generic payment record for Explore verticals (bookings, events, premium).
 * Gift payments still use GiftPaymentModel.js (untouched).
 */
const paymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "UserProfile", required: true, index: true },
    // Which vertical this payment is for
    entityType: {
      type: String,
      enum: ["BOOKING", "EVENT_TICKET", "PREMIUM"],
      required: true,
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    mode: { type: String, enum: ["PLACEHOLDER", "RAZORPAY"], required: true },
    provider: { type: String, default: "RAZORPAY" },
    providerOrderId: { type: String },
    providerPaymentId: { type: String },
    idempotencyKey: { type: String, unique: true, sparse: true },
    status: {
      type: String,
      enum: ["INITIATED", "PAID", "FAILED", "REFUNDED"],
      default: "INITIATED",
    },
    verifiedAt: { type: Date },
    failureReason: { type: String },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

paymentSchema.index({ entityType: 1, entityId: 1, status: 1 });

export default mongoose.model("Payment", paymentSchema);
