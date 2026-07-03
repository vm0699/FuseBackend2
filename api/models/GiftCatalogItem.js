import mongoose from "mongoose";

/**
 * GiftCatalogItem — the platform-approved source of truth for gift products.
 *
 * The backend NEVER trusts a client-supplied price. All amounts come from this
 * model. Only active LOW/MID items may be purchased.
 *
 * finalAmount must equal price + platformFee + deliveryFee, and price must sit
 * inside the tier band (LOW <= 499, MID 500..2999).
 */
export const GIFT_TIER_BANDS = {
  LOW: { min: 1, max: 499 },
  MID: { min: 500, max: 2999 },
};

export const GIFT_OCCASIONS = [
  "JUST_BECAUSE",
  "CELEBRATION",
  "FIRST_DATE",
  "APOLOGY",
  "THANK_YOU",
];

const GiftCatalogItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },

    tier: {
      type: String,
      enum: ["LOW", "MID"],
      required: true,
    },

    imageUrl: { type: String, default: "" },

    // Pricing — explicit per-item (INR). Backend computes nothing implicitly.
    price: { type: Number, required: true, min: 0 },
    platformFee: { type: Number, default: 0, min: 0 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    finalAmount: { type: Number, required: true, min: 0 },

    category: { type: String, default: "" },
    occasion: {
      type: String,
      enum: GIFT_OCCASIONS,
      default: "JUST_BECAUSE",
    },

    // Lowercased tags matched against UserProfile.interests for "Suggested" picks
    interestTags: { type: [String], default: [] },

    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

// Integrity guard: amounts and tier band must be consistent.
GiftCatalogItemSchema.pre("validate", function validateGiftCatalogItem(next) {
  const expectedFinal =
    Number(this.price || 0) +
    Number(this.platformFee || 0) +
    Number(this.deliveryFee || 0);

  if (Number(this.finalAmount) !== expectedFinal) {
    return next(
      new Error(
        `finalAmount (${this.finalAmount}) must equal price + platformFee + deliveryFee (${expectedFinal})`
      )
    );
  }

  const band = GIFT_TIER_BANDS[this.tier];
  if (!band) {
    return next(new Error(`Invalid tier: ${this.tier}`));
  }
  if (this.price < band.min || this.price > band.max) {
    return next(
      new Error(
        `${this.tier} price ${this.price} is outside band ${band.min}-${band.max}`
      )
    );
  }

  next();
});

GiftCatalogItemSchema.index({ isActive: 1, tier: 1, sortOrder: 1 });
GiftCatalogItemSchema.index({ isActive: 1, occasion: 1, sortOrder: 1 });

export default mongoose.model("GiftCatalogItem", GiftCatalogItemSchema);
