import mongoose from "mongoose";

/**
 * Single source of truth for Event Circle membership.
 * Created by a user RSVP'ing (FREE_RSVP / PAID_EXTERNAL) or by a confirmed
 * PAID_FUSE ticket order (source: TICKET) — both doors lead to the same circle.
 */
const eventRsvpSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "UserProfile", required: true, index: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },

    status: {
      type: String,
      enum: ["GOING", "CANCELLED", "CHECKED_IN"],
      default: "GOING",
      required: true,
    },
    source: {
      type: String,
      enum: ["RSVP", "TICKET"],
      default: "RSVP",
    },
    ticketOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "EventTicketOrder", default: null },

    showMeInCircle: { type: Boolean, default: true },

    // Snapshot at RSVP time — keeps rate-limit/upcoming queries cheap without joining Event.
    eventSnapshot: {
      title: String,
      eventDate: Date,
      eventEndDate: Date,
    },

    checkedInAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    promoRevealedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

eventRsvpSchema.index({ userId: 1, eventId: 1 }, { unique: true });
eventRsvpSchema.index({ eventId: 1, status: 1 });
eventRsvpSchema.index({ userId: 1, status: 1, "eventSnapshot.eventDate": 1 });
eventRsvpSchema.index({ status: 1, checkedInAt: 1 });

export default mongoose.model("EventRsvp", eventRsvpSchema);
