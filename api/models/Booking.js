import mongoose from "mongoose";
import crypto from "crypto";

/**
 * Date booking at a Fuse-verified venue.
 * Flow: CREATED → INVITE_PENDING? → CONFIRMED (paid) → ADMIN_REVIEW → FULFILLED
 *       → CANCELLED | REFUND_REQUIRED | REFUNDED
 */
const BOOKING_STATUSES = [
  "CREATED",
  "INVITE_PENDING",   // waiting for invited match to accept (48h expiry)
  "CONFIRMED",        // payment successful
  "ADMIN_REVIEW",
  "FULFILLED",
  "CANCELLED",
  "REFUND_REQUIRED",
  "REFUNDED",
];

const bookingSchema = new mongoose.Schema(
  {
    bookingCode: {
      type: String,
      unique: true,
      default: () => `FUSE-B-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "UserProfile", required: true, index: true },
    venueId: { type: mongoose.Schema.Types.ObjectId, ref: "Venue", required: true },
    // Snapshot of venue at booking time
    venueSnapshot: {
      name: String,
      area: String,
      city: { type: String, default: "Chennai" },
      address: String,        // revealed to user only after CONFIRMED
      bookingFee: Number,
      dinerDiscountPct: Number,
    },
    date: { type: Date, required: true },
    timeSlot: { type: String }, // e.g. "7:00 PM"
    partySize: { type: Number, default: 2, min: 1 },
    specialNotes: { type: String, maxlength: 500 },

    // Invite-a-match
    invitedMatchId: { type: mongoose.Schema.Types.ObjectId, ref: "UserProfile" },
    inviteStatus: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "DECLINED", "EXPIRED", null],
      default: null,
    },
    inviteExpiresAt: { type: Date },

    // Payment
    totalAmount: { type: Number, required: true },    // booking fee total (INR)
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
    paidAt: { type: Date },

    status: { type: String, enum: BOOKING_STATUSES, default: "CREATED", required: true, index: true },
    statusHistory: [
      {
        status: String,
        action: String,
        byUserId: { type: mongoose.Schema.Types.ObjectId, ref: "UserProfile" },
        byRole: { type: String, enum: ["USER", "ADMIN", "SYSTEM", "MATCH"] },
        note: String,
        at: { type: Date, default: Date.now },
      },
    ],
    adminNotes: { type: String },
    city: { type: String, default: "Chennai" },

    cancelledAt: Date,
    refundRequiredAt: Date,
    refundedAt: Date,
    fulfilledAt: Date,
  },
  { timestamps: true }
);

bookingSchema.index({ userId: 1, createdAt: -1 });
bookingSchema.index({ status: 1, createdAt: -1 });
bookingSchema.index({ invitedMatchId: 1 });
bookingSchema.index({ inviteExpiresAt: 1, inviteStatus: 1 });

export default mongoose.model("Booking", bookingSchema);
