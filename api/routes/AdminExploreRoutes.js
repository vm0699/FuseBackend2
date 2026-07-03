/**
 * Admin routes for Fuse Explore — mounted at /api/admin/explore
 * Protected by authMiddleware + adminMiddleware.
 */
import express from "express";
import {
  getAdminBookings,
  updateBookingStatus,
  updateBookingNotes,
  getAdminTicketOrders,
  updateTicketOrderStatus,
  updateTicketOrderNotes,
  getAdminPremiumRequests,
  quotePremiumRequest,
  updatePremiumStatus,
  upsertVenue,
  upsertEvent,
} from "../controllers/AdminExploreController.js";

const router = express.Router();

// Auth + admin applied at mount in server.js

// ─── Bookings ─────────────────────────────────────────────────────────────────
router.get("/bookings", getAdminBookings);
router.patch("/bookings/:bookingId/status", updateBookingStatus);
router.patch("/bookings/:bookingId/notes", updateBookingNotes);

// ─── Ticket orders ─────────────────────────────────────────────────────────────
router.get("/tickets", getAdminTicketOrders);
router.patch("/tickets/:orderId/status", updateTicketOrderStatus);
router.patch("/tickets/:orderId/notes", updateTicketOrderNotes);

// ─── Premium ──────────────────────────────────────────────────────────────────
router.get("/premium", getAdminPremiumRequests);
router.patch("/premium/:requestId/quote", quotePremiumRequest);
router.patch("/premium/:requestId/status", updatePremiumStatus);

// ─── Content management ───────────────────────────────────────────────────────
router.post("/venues", upsertVenue);
router.patch("/venues/:venueId", upsertVenue);
router.post("/events", upsertEvent);
router.patch("/events/:eventId", upsertEvent);

export default router;
