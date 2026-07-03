import mongoose from "mongoose";
import crypto from "crypto";

/**
 * Ticket order for a curated local event.
 * Flow: CREATED → CONFIRMED (paid) → ADMIN_REVIEW → FULFILLED (ticket forwarded)
 *       → CANCELLED | REFUND_REQUIRED | REFUNDED
 */
const TICKET_STATUSES = [
  "CREATED",
  "CONFIRMED",
  "ADMIN_REVIEW",
  "FULFILLED",
  "CANCELLED",
  "REFUND_REQUIRED",
  "REFUNDED",
];

const eventTicketOrderSchema = new mongoose.Schema(
  {
    ticketCode: {
      type: String,
      unique: true,
      default: () => `FUSE-T-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "UserProfile", required: true, index: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true },
    // Snapshot of event at order time
    eventSnapshot: {
      title: String,
      venue: String,
      city: { type: String, default: "Chennai" },
      address: String,      // revealed to user after FULFILLED
      eventDate: Date,
      ticketPrice: Number,
    },
    quantity: { type: Number, required: true, min: 1, max: 10 },
    totalAmount: { type: Number, required: true },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
    paidAt: { type: Date },

    // Admin fulfils by attaching ticket reference (code, PDF link, etc.)
    ticketReference: { type: String },
    ticketAttachment: { type: String },   // URL to ticket PDF/image

    status: { type: String, enum: TICKET_STATUSES, default: "CREATED", required: true, index: true },
    statusHistory: [
      {
        status: String,
        action: String,
        byUserId: { type: mongoose.Schema.Types.ObjectId, ref: "UserProfile" },
        byRole: { type: String, enum: ["USER", "ADMIN", "SYSTEM"] },
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

eventTicketOrderSchema.index({ userId: 1, createdAt: -1 });
eventTicketOrderSchema.index({ eventId: 1, status: 1 });
eventTicketOrderSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("EventTicketOrder", eventTicketOrderSchema);
