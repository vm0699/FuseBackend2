import mongoose from "mongoose";

/**
 * Fuse-curated date venue (cafe, restaurant, activity spot).
 * Only public, Fuse-verified venues. No private/hotel-room/adult listings.
 */
const venueSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    city: { type: String, default: "Chennai", index: true },
    area: { type: String, trim: true },
    address: { type: String, trim: true },
    location: {
      latitude: { type: Number },
      longitude: { type: Number },
    },
    category: {
      type: String,
      enum: ["cafe", "restaurant", "activity", "rooftop", "dessert", "other"],
      default: "cafe",
    },
    cuisine: { type: String },
    priceRange: { type: String, enum: ["budget", "mid", "premium"], default: "mid" },
    // Booking fee charged by Fuse per reservation (INR). Revenue = bookingFee.
    bookingFee: { type: Number, default: 49, min: 0 },
    // Per-cover commission (%) negotiated with venue. 0 = no deal yet.
    venueCommissionPct: { type: Number, default: 0, min: 0, max: 100 },
    // Diner discount shown in UI (%) — only show when venueCommissionPct > 0.
    dinerDiscountPct: { type: Number, default: 0, min: 0, max: 100 },
    images: [{ type: String }],
    tags: [{ type: String }],
    interestTags: [{ type: String }],
    openingHours: { type: String },
    maxPartySize: { type: Number, default: 10 },
    isFuseVerified: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    rating: { type: Number, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

venueSchema.index({ isActive: 1, city: 1, sortOrder: 1 });
venueSchema.index({ isActive: 1, category: 1, city: 1 });

export default mongoose.model("Venue", venueSchema);
