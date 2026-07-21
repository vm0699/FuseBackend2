/**
 * Fuse Explore routes — mounted at /api/explore
 * Public read: auth required (all onboarded users can browse)
 * Write actions: auth required (some also require match eligibility checked in controller)
 */
import express from "express";
import {
  getExploreHome,
  getVenues,
  getVenueDetail,
  getEvents,
  getEventDetail,
} from "../controllers/ExploreController.js";
import {
  createBooking,
  initiateBookingPayment,
  confirmBookingPayment,
  respondToInvite,
  cancelBooking,
  getMyBookings,
  getBookingDetail,
} from "../controllers/BookingController.js";
import {
  initiateTicketPurchase,
  confirmTicketPayment,
  getMyTicketOrders,
  getTicketOrderDetail,
} from "../controllers/EventController.js";
import {
  submitPremiumRequest,
  initiatePremiumPayment,
  confirmPremiumPayment,
  getMyPremiumRequests,
} from "../controllers/PremiumController.js";
import {
  createRsvp,
  cancelRsvp,
  updateRsvpVisibility,
  getMyEvents,
  checkin,
  getCircle,
  wave,
} from "../controllers/EventCircleController.js";
import exploreCommerceGuard from "../middleware/exploreCommerceGuard.js";

const router = express.Router();

// ─── Explore home & catalog (READ — always open, powers browsing) ──────────────
router.get("/home", getExploreHome);
router.get("/venues", getVenues);
router.get("/venues/:venueId", getVenueDetail);
router.get("/events", getEvents);
router.get("/events/:eventId", getEventDetail);

// ─── Read-only user history (open — lists are empty until commerce is live) ─────
router.get("/events/:eventId/circle", getCircle);
router.get("/my-events", getMyEvents);
router.get("/bookings", getMyBookings);
router.get("/bookings/:bookingId", getBookingDetail);
router.get("/tickets", getMyTicketOrders);
router.get("/tickets/:orderId", getTicketOrderDetail);
router.get("/premium", getMyPremiumRequests);

// ─── Committing / commerce actions (gated by exploreCommerceGuard) ──────────────
// Blocked with 503 EXPLORE_COMING_SOON until EXPLORE_COMMERCE_LIVE=true.

// Event circle (Iteration 2: RSVP lifecycle)
router.post("/events/:eventId/rsvp", exploreCommerceGuard, createRsvp);
router.post("/events/:eventId/rsvp/cancel", exploreCommerceGuard, cancelRsvp);
router.patch("/events/:eventId/rsvp", exploreCommerceGuard, updateRsvpVisibility);
router.post("/events/:eventId/wave", exploreCommerceGuard, wave);
router.post("/events/:eventId/checkin", exploreCommerceGuard, checkin);

// Date bookings
router.post("/bookings", exploreCommerceGuard, createBooking);
router.post("/bookings/:bookingId/pay", exploreCommerceGuard, initiateBookingPayment);
router.post("/bookings/:bookingId/pay/confirm", exploreCommerceGuard, confirmBookingPayment);
router.post("/bookings/:bookingId/invite-response", exploreCommerceGuard, respondToInvite);
router.post("/bookings/:bookingId/cancel", exploreCommerceGuard, cancelBooking);

// Event tickets
router.post("/tickets", exploreCommerceGuard, initiateTicketPurchase);
router.post("/tickets/:orderId/pay/confirm", exploreCommerceGuard, confirmTicketPayment);

// Premium
router.post("/premium", exploreCommerceGuard, submitPremiumRequest);
router.post("/premium/:requestId/pay", exploreCommerceGuard, initiatePremiumPayment);
router.post("/premium/:requestId/pay/confirm", exploreCommerceGuard, confirmPremiumPayment);

export default router;
