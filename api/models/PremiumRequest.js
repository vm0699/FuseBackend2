import mongoose from "mongoose";

/**
 * Premium / concierge experience request.
 * HIGH-value items go here; no instant self-serve payment.
 * Flow: SUBMITTED → CONTACTED → QUOTED → ACCEPTED → PAID → FULFILLED
 *       → CANCELLED | DECLINED
 */
const PREMIUM_STATUSES = [
  "SUBMITTED",
  "CONTACTED",   // ops contacted the user
  "QUOTED",      // price quoted; awaiting user accept
  "ACCEPTED",    // user accepted the quote
  "PAID",
  "FULFILLED",
  "CANCELLED",
  "DECLINED",
];

const premiumRequestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "UserProfile", required: true, index: true },
    occasion: {
      type: String,
      enum: ["ANNIVERSARY", "BIRTHDAY", "FIRST_DATE", "PROPOSAL", "CELEBRATION", "SURPRISE", "OTHER"],
      required: true,
    },
    budget: { type: Number, required: true, min: 3000 },  // HIGH tier starts above MID (>₹2999)
    notes: { type: String, maxlength: 1000 },

    // Optional: for a match
    forMatchId: { type: mongoose.Schema.Types.ObjectId, ref: "UserProfile" },
    requiresMatchApproval: { type: Boolean, default: false },
    matchApprovalStatus: {
      type: String,
      enum: ["PENDING", "APPROVED", "DECLINED", null],
      default: null,
    },

    // Admin sets the final quoted price
    quotedAmount: { type: Number },
    quotedAt: { type: Date },
    quotedBy: { type: mongoose.Schema.Types.ObjectId, ref: "UserProfile" },

    // Payment after quote accepted
    finalAmount: { type: Number },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
    paidAt: { type: Date },

    status: { type: String, enum: PREMIUM_STATUSES, default: "SUBMITTED", required: true, index: true },
    statusHistory: [
      {
        status: String,
        action: String,
        byUserId: { type: mongoose.Schema.Types.ObjectId, ref: "UserProfile" },
        byRole: { type: String, enum: ["USER", "ADMIN", "MATCH", "SYSTEM"] },
        note: String,
        at: { type: Date, default: Date.now },
      },
    ],
    adminNotes: { type: String },
    city: { type: String, default: "Chennai" },

    fulfilledAt: Date,
    cancelledAt: Date,
  },
  { timestamps: true }
);

premiumRequestSchema.index({ userId: 1, createdAt: -1 });
premiumRequestSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("PremiumRequest", premiumRequestSchema);
