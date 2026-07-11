/**
 * Explore home and catalog endpoints.
 * Serves the Explore home, venue list, event list, and individual detail pages.
 */
import Venue from "../models/Venue.js";
import Event from "../models/Event.js";
import EventRsvp from "../models/EventRsvp.js";
import GiftCatalogItem from "../models/GiftCatalogItem.js";
import UserProfile from "../models/UserProfile.js";
import { logEvent } from "../services/analytics/logEvent.js";

// â”€â”€â”€ Home â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getExploreHome = async (req, res) => {
  try {
    const city = process.env.FUSE_LAUNCH_CITY || "Chennai";
    const userId = req.user.id;
    const mode = req.query.mode === "people" || req.query.mode === "dates" ? req.query.mode : null;

    const me = await UserProfile.findById(userId).select("matches").lean();
    const defaultMode = (me?.matches?.length || 0) > 0 ? "dates" : "people";

    logEvent("explore_home_viewed", userId, { city, mode: mode || "legacy" });

    if (mode === "people") {
      const [myUpcomingEvents, thisWeekend, freeEvents, featuredSocial] = await Promise.all([
        EventRsvp.find({ userId, status: { $in: ["GOING", "CHECKED_IN"] } })
          .sort({ "eventSnapshot.eventDate": 1 })
          .limit(10)
          .lean()
          .then((rsvps) => Event.find({ _id: { $in: rsvps.map((r) => r.eventId) } }).lean()),
        Event.find({
          isActive: true,
          city,
          audience: "MEET_PEOPLE",
          eventDate: { $gte: new Date(), $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        }).sort({ eventDate: 1 }).limit(6).lean(),
        Event.find({
          isActive: true,
          city,
          audience: "MEET_PEOPLE",
          pricingType: "FREE_RSVP",
          eventDate: { $gte: new Date() },
        }).sort({ eventDate: 1 }).limit(6).lean(),
        Event.find({
          isActive: true,
          city,
          audience: "MEET_PEOPLE",
          isFeatured: true,
          eventDate: { $gte: new Date() },
        }).sort({ eventDate: 1 }).limit(6).lean(),
      ]);

      return res.json({
        success: true,
        city,
        mode: "people",
        defaultMode,
        home: {
          myUpcomingEvents: myUpcomingEvents.map(serializeEvent),
          thisWeekend: thisWeekend.map(serializeEvent),
          freeEvents: freeEvents.map(serializeEvent),
          featuredSocial: featuredSocial.map(serializeEvent),
        },
      });
    }

    // "dates" mode, and the legacy no-mode call (kept byte-identical below + defaultMode appended)
    const [featuredVenues, upcomingEvents, giftSuggestions, featuredEvents] =
      await Promise.all([
        Venue.find({ isActive: true, city }).sort({ sortOrder: 1 }).limit(5).lean(),
        Event.find({
          isActive: true,
          city,
          ...(mode === "dates" ? { audience: "DATE_IDEA" } : {}),
          eventDate: { $gte: new Date() },
        })
          .sort({ eventDate: 1 })
          .limit(4)
          .lean(),
        GiftCatalogItem.find({ isActive: true, tier: { $in: ["LOW", "MID"] } })
          .sort({ sortOrder: 1 })
          .limit(4)
          .lean(),
        Event.find({
          isActive: true,
          city,
          isFeatured: true,
          ...(mode === "dates" ? { audience: "DATE_IDEA" } : {}),
          eventDate: { $gte: new Date() },
        })
          .sort({ eventDate: 1 })
          .limit(3)
          .lean(),
      ]);

    res.json({
      success: true,
      city,
      ...(mode ? { mode } : {}),
      defaultMode,
      home: {
        featuredVenues: featuredVenues.map(serializeVenue),
        upcomingEvents: upcomingEvents.map(serializeEvent),
        featuredEvents: featuredEvents.map(serializeEvent),
        giftSuggestions: giftSuggestions.map(serializeGiftItem),
      },
    });
  } catch (err) {
    console.error("[ExploreController] getExploreHome:", err);
    res.status(500).json({ success: false, message: "Failed to load Explore home." });
  }
};

// â”€â”€â”€ Venues â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getVenues = async (req, res) => {
  try {
    const city = process.env.FUSE_LAUNCH_CITY || "Chennai";
    const userId = req.user.id;
    const { category, limit = 20, offset = 0 } = req.query;

    const filter = { isActive: true, city };
    if (category) filter.category = category;

    const venues = await Venue.find(filter)
      .sort({ sortOrder: 1, rating: -1 })
      .skip(Number(offset))
      .limit(Math.min(Number(limit), 50))
      .lean();

    logEvent("explore_category_viewed", userId, { category: "venues", city });

    res.json({ success: true, venues: venues.map(serializeVenue) });
  } catch (err) {
    console.error("[ExploreController] getVenues:", err);
    res.status(500).json({ success: false, message: "Failed to load venues." });
  }
};

export const getVenueDetail = async (req, res) => {
  try {
    const { venueId } = req.params;
    const userId = req.user.id;
    const venue = await Venue.findOne({ _id: venueId, isActive: true }).lean();
    if (!venue) return res.status(404).json({ success: false, message: "Venue not found." });

    logEvent("explore_listing_viewed", userId, {
      listingId: venue._id,
      listingType: "venue",
      category: venue.category,
    });

    res.json({ success: true, venue: serializeVenueDetail(venue) });
  } catch (err) {
    console.error("[ExploreController] getVenueDetail:", err);
    res.status(500).json({ success: false, message: "Failed to load venue." });
  }
};

// â”€â”€â”€ Events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getEvents = async (req, res) => {
  try {
    const city = process.env.FUSE_LAUNCH_CITY || "Chennai";
    const userId = req.user.id;
    const { category, audience, pricingType, limit = 20, offset = 0 } = req.query;

    const filter = { isActive: true, city, eventDate: { $gte: new Date() } };
    if (category) filter.category = category;
    if (audience) filter.audience = audience;
    if (pricingType) filter.pricingType = pricingType;

    const events = await Event.find(filter)
      .sort({ eventDate: 1 })
      .skip(Number(offset))
      .limit(Math.min(Number(limit), 50))
      .lean();

    logEvent("explore_category_viewed", userId, { category: "events", city });

    res.json({ success: true, events: events.map(serializeEvent) });
  } catch (err) {
    console.error("[ExploreController] getEvents:", err);
    res.status(500).json({ success: false, message: "Failed to load events." });
  }
};

export const getEventDetail = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;
    const event = await Event.findOne({ _id: eventId, isActive: true }).lean();
    if (!event) return res.status(404).json({ success: false, message: "Event not found." });

    logEvent("explore_listing_viewed", userId, {
      listingId: event._id,
      listingType: "event",
      category: event.category,
    });

    const myRsvp = await EventRsvp.findOne({ userId, eventId }).lean();
    const hasActiveRsvp = myRsvp && ["GOING", "CHECKED_IN"].includes(myRsvp.status);

    res.json({
      success: true,
      event: {
        ...serializeEventDetail(event),
        myRsvp: hasActiveRsvp ? { status: myRsvp.status, showMeInCircle: myRsvp.showMeInCircle } : null,
        promoCode: hasActiveRsvp && event.pricingType === "PAID_EXTERNAL" ? event.promoCode : undefined,
      },
    });
  } catch (err) {
    console.error("[ExploreController] getEventDetail:", err);
    res.status(500).json({ success: false, message: "Failed to load event." });
  }
};

// â”€â”€â”€ Serializers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const serializeVenue = (v) => ({
  _id: v._id,
  name: v.name,
  area: v.area,
  city: v.city,
  category: v.category,
  cuisine: v.cuisine,
  priceRange: v.priceRange,
  bookingFee: v.bookingFee,
  dinerDiscountPct: v.venueCommissionPct > 0 ? v.dinerDiscountPct : 0,
  hasDiscount: v.venueCommissionPct > 0 && v.dinerDiscountPct > 0,
  images: v.images || [],
  tags: v.tags || [],
  isFuseVerified: v.isFuseVerified,
  rating: v.rating,
  openingHours: v.openingHours,
  maxPartySize: v.maxPartySize,
});

const serializeVenueDetail = (v) => ({
  ...serializeVenue(v),
  description: v.description,
  interestTags: v.interestTags,
  reviewCount: v.reviewCount,
  // Address only revealed after booking confirmation; omit here
});

const serializeEvent = (e) => ({
  _id: e._id,
  title: e.title,
  city: e.city,
  venue: e.venue,
  category: e.category,
  eventDate: e.eventDate,
  images: e.images || [],
  tags: e.tags || [],
  ticketPrice: e.ticketPrice,
  originalPrice: e.originalPrice,
  savingsAmount: e.originalPrice > e.ticketPrice ? e.originalPrice - e.ticketPrice : 0,
  availableSlots: e.totalSlots != null ? Math.max(0, e.totalSlots - (e.soldSlots || 0)) : null,
  isSoldOut:
    e.totalSlots != null
      ? (e.soldSlots || 0) >= e.totalSlots
      : e.rsvpCap != null
      ? (e.rsvpCount || 0) >= e.rsvpCap
      : false,
  isFeatured: e.isFeatured,
  agePolicy: e.agePolicy,
  // ─── Iteration 2 fields ───
  audience: e.audience || "MEET_PEOPLE",
  pricingType: e.pricingType || "PAID_FUSE",
  organizer: e.organizer?.name ? { name: e.organizer.name, instagram: e.organizer.instagram } : undefined,
  externalBookingUrl: e.pricingType === "PAID_EXTERNAL" ? e.externalBookingUrl : undefined,
  externalPrice: e.externalPrice,
  rsvpCap: e.rsvpCap ?? null,
  goingCount: e.rsvpCount || 0,
  // checkInCode, organizer.phone, and promoCode are never included here (admin/viewer-gated only).
});

const serializeEventDetail = (e) => ({
  ...serializeEvent(e),
  description: e.description,
  dressCode: e.dressCode,
  importantInfo: e.importantInfo,
  maxPerOrder: e.maxPerOrder,
  eventEndDate: e.eventEndDate,
  // Address only revealed after ticket confirmation; omit here
});

const serializeGiftItem = (g) => ({
  _id: g._id,
  name: g.name,
  tier: g.tier,
  finalAmount: g.finalAmount,
  imageUrl: g.imageUrl,
  occasion: g.occasion,
  category: g.category,
});

export default {
  getExploreHome,
  getVenues,
  getVenueDetail,
  getEvents,
  getEventDetail,
};

