import mongoose from "mongoose";

/**
 * Curated local event (comedy show, house party, local happening in/around Chennai).
 * Fuse resells tickets; manual sourcing by ops.
 */
const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    city: { type: String, default: "Chennai", index: true },
    venue: { type: String, trim: true },
    address: { type: String },          // revealed after ticket purchase
    location: {
      latitude: Number,
      longitude: Number,
    },
    category: {
      type: String,
      enum: ["comedy", "music", "party", "social", "sports", "workshop", "food", "other"],
      default: "social",
    },
    eventDate: { type: Date, required: true, index: true },
    eventEndDate: { type: Date },
    images: [{ type: String }],
    tags: [{ type: String }],

    // Ticketing (required only for pricingType: PAID_FUSE — enforced in AdminExploreController, not schema,
    // because update-validators run with a different `this` and can't safely reference pricingType here)
    ticketPrice: { type: Number, min: 0 },                    // Fuse resell price (INR)
    originalPrice: { type: Number },                          // organizer's price (for showing "Save ₹X")
    totalSlots: { type: Number },
    soldSlots: { type: Number, default: 0 },
    maxPerOrder: { type: Number, default: 4 },

    isActive: { type: Boolean, default: true, index: true },
    isFeatured: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },

    agePolicy: { type: String },    // e.g. "18+" or "All ages"
    dressCode: { type: String },
    importantInfo: { type: String },

    // ===== Iteration 2: audience segmentation + social event aggregation =====
    audience: {
      type: String,
      enum: ["DATE_IDEA", "MEET_PEOPLE"],
      default: "MEET_PEOPLE",
      index: true,
    },
    pricingType: {
      type: String,
      enum: ["FREE_RSVP", "PAID_EXTERNAL", "PAID_FUSE"],
      default: "PAID_FUSE",
    },
    organizer: {
      name: { type: String },
      instagram: { type: String },
      phone: { type: String },   // never serialized to the app
    },
    externalBookingUrl: { type: String },   // PAID_EXTERNAL: organizer's booking link
    externalPrice: { type: String },        // PAID_EXTERNAL: display string, e.g. "₹499 onwards"
    promoCode: { type: String },            // revealed to the app only after the viewer has RSVP'd

    // Check-in (admin-only fields, never serialized to the app)
    checkInCode: { type: String },
    checkInOpensAt: { type: Date },
    checkInClosesAt: { type: Date },

    // RSVP capacity (FREE_RSVP / PAID_EXTERNAL circles)
    rsvpCap: { type: Number, default: null },
    rsvpCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

eventSchema.index({ isActive: 1, eventDate: 1, city: 1 });
eventSchema.index({ isActive: 1, isFeatured: 1, eventDate: 1 });
eventSchema.index({ isActive: 1, audience: 1, eventDate: 1, city: 1 });

export default mongoose.model("Event", eventSchema);
