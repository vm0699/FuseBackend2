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

    // Ticketing
    ticketPrice: { type: Number, required: true, min: 0 },   // Fuse resell price (INR)
    originalPrice: { type: Number },                          // organizer's price (for showing "Save ₹X")
    totalSlots: { type: Number, required: true },
    soldSlots: { type: Number, default: 0 },
    maxPerOrder: { type: Number, default: 4 },

    isActive: { type: Boolean, default: true, index: true },
    isFeatured: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },

    agePolicy: { type: String },    // e.g. "18+" or "All ages"
    dressCode: { type: String },
    importantInfo: { type: String },
  },
  { timestamps: true }
);

eventSchema.index({ isActive: 1, eventDate: 1, city: 1 });
eventSchema.index({ isActive: 1, isFeatured: 1, eventDate: 1 });

export default mongoose.model("Event", eventSchema);
