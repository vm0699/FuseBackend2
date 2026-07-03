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

const router = express.Router();

// ─── Explore home & catalog ───────────────────────────────────────────────────
router.get("/home", getExploreHome);
router.get("/venues", getVenues);
router.get("/venues/:venueId", getVenueDetail);
router.get("/events", getEvents);
router.get("/events/:eventId", getEventDetail);

// ─── Date bookings ────────────────────────────────────────────────────────────
router.post("/bookings", createBooking);
router.get("/bookings", getMyBookings);
router.get("/bookings/:bookingId", getBookingDetail);
router.post("/bookings/:bookingId/pay", initiateBookingPayment);
router.post("/bookings/:bookingId/pay/confirm", confirmBookingPayment);
router.post("/bookings/:bookingId/invite-response", respondToInvite);
router.post("/bookings/:bookingId/cancel", cancelBooking);

// ─── Event tickets ────────────────────────────────────────────────────────────
router.post("/tickets", initiateTicketPurchase);
router.post("/tickets/:orderId/pay/confirm", confirmTicketPayment);
router.get("/tickets", getMyTicketOrders);
router.get("/tickets/:orderId", getTicketOrderDetail);

// ─── Premium ──────────────────────────────────────────────────────────────────
router.post("/premium", submitPremiumRequest);
router.get("/premium", getMyPremiumRequests);
router.post("/premium/:requestId/pay", initiatePremiumPayment);
router.post("/premium/:requestId/pay/confirm", confirmPremiumPayment);

export default router;
