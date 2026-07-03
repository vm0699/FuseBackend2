/**
 * Admin controller for Fuse Explore orders (bookings, tickets, premium).
 * All routes are protected by authMiddleware + adminMiddleware.
 * Replicates the same pattern as AdminGiftController.js.
 */
import Booking from "../models/Booking.js";
import EventTicketOrder from "../models/EventTicketOrder.js";
import PremiumRequest from "../models/PremiumRequest.js";
import Venue from "../models/Venue.js";
import Event from "../models/Event.js";
import notificationService from "../services/notificationService.js";
import { NOTIFICATION_TYPES } from "../services/notifications/notificationTypes.js";

// â”€â”€â”€ Bookings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getAdminBookings = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = status ? { status } : {};
    const bookings = await Booking.find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate("userId", "name phoneNumber")
      .populate("invitedMatchId", "name phoneNumber")
      .lean();
    res.json({ success: true, bookings: bookings.map(serializeAdminBooking) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateBookingStatus = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { bookingId } = req.params;
    const { action, note } = req.body;

    const ACTION_MAP = {
      CONFIRM: "CONFIRMED",
      MARK_FULFILLED: "FULFILLED",
      CANCEL: "CANCELLED",
      MARK_REFUND_REQUIRED: "REFUND_REQUIRED",
      MARK_REFUNDED: "REFUNDED",
    };
    const newStatus = ACTION_MAP[action];
    if (!newStatus) return res.status(400).json({ success: false, message: "Unknown action." });

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });

    booking.status = newStatus;
    booking.statusHistory.push({
      status: newStatus,
      action,
      byUserId: adminId,
      byRole: "ADMIN",
      note,
    });
    if (newStatus === "FULFILLED") booking.fulfilledAt = new Date();
    if (newStatus === "CANCELLED") booking.cancelledAt = new Date();
    if (newStatus === "REFUND_REQUIRED") booking.refundRequiredAt = new Date();
    if (newStatus === "REFUNDED") booking.refundedAt = new Date();
    await booking.save();

    notificationService
      .sendToUser(
        booking.userId,
        notificationService.buildNotificationPayload({
          type: NOTIFICATION_TYPES.BOOKING_CONFIRMED,
          body: `Your booking status has been updated: ${newStatus}.`,
          data: { bookingId: booking._id.toString() },
        })
      )
      .catch(() => {});

    res.json({ success: true, bookingStatus: booking.status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateBookingNotes = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { notes } = req.body;
    await Booking.findByIdAndUpdate(bookingId, { adminNotes: notes });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// â”€â”€â”€ Ticket orders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getAdminTicketOrders = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = status ? { status } : {};
    const orders = await EventTicketOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate("userId", "name phoneNumber")
      .lean();
    res.json({ success: true, orders: orders.map(serializeAdminTicketOrder) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateTicketOrderStatus = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { orderId } = req.params;
    const { action, ticketReference, ticketAttachment, note } = req.body;

    const ACTION_MAP = {
      MARK_FULFILLED: "FULFILLED",
      CANCEL: "CANCELLED",
      MARK_REFUND_REQUIRED: "REFUND_REQUIRED",
      MARK_REFUNDED: "REFUNDED",
    };
    const newStatus = ACTION_MAP[action];
    if (!newStatus) return res.status(400).json({ success: false, message: "Unknown action." });

    const order = await EventTicketOrder.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    order.status = newStatus;
    if (ticketReference) order.ticketReference = ticketReference;
    if (ticketAttachment) order.ticketAttachment = ticketAttachment;
    order.statusHistory.push({ status: newStatus, action, byUserId: adminId, byRole: "ADMIN", note });
    if (newStatus === "FULFILLED") order.fulfilledAt = new Date();
    if (newStatus === "CANCELLED") order.cancelledAt = new Date();
    if (newStatus === "REFUND_REQUIRED") order.refundRequiredAt = new Date();
    if (newStatus === "REFUNDED") order.refundedAt = new Date();
    await order.save();

    if (newStatus === "FULFILLED") {
      notificationService
        .sendToUser(
          order.userId,
          notificationService.buildNotificationPayload({
            type: NOTIFICATION_TYPES.TICKET_FULFILLED,
            body: `Your ticket for "${order.eventSnapshot?.title}" is ready!`,
            data: { orderId: order._id.toString() },
          })
        )
        .catch(() => {});
    }

    res.json({ success: true, orderStatus: order.status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateTicketOrderNotes = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { notes, ticketReference, ticketAttachment } = req.body;
    const update = { adminNotes: notes };
    if (ticketReference !== undefined) update.ticketReference = ticketReference;
    if (ticketAttachment !== undefined) update.ticketAttachment = ticketAttachment;
    await EventTicketOrder.findByIdAndUpdate(orderId, update);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// â”€â”€â”€ Premium requests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getAdminPremiumRequests = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = status ? { status } : {};
    const requests = await PremiumRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate("userId", "name phoneNumber")
      .populate("forMatchId", "name")
      .lean();
    res.json({ success: true, requests });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const quotePremiumRequest = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { requestId } = req.params;
    const { quotedAmount, note } = req.body;

    const request = await PremiumRequest.findById(requestId);
    if (!request) return res.status(404).json({ success: false, message: "Request not found." });

    request.quotedAmount = quotedAmount;
    request.quotedAt = new Date();
    request.quotedBy = adminId;
    request.status = "QUOTED";
    request.statusHistory.push({ status: "QUOTED", action: "QUOTED", byUserId: adminId, byRole: "ADMIN", note });
    await request.save();

    notificationService
      .sendToUser(
        request.userId,
        notificationService.buildNotificationPayload({
          type: NOTIFICATION_TYPES.PREMIUM_QUOTE_READY,
          body: `Your premium experience quote (â‚¹${quotedAmount.toLocaleString("en-IN")}) is ready!`,
          data: { requestId: request._id.toString() },
        })
      )
      .catch(() => {});

    res.json({ success: true, requestStatus: request.status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updatePremiumStatus = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { requestId } = req.params;
    const { action, note } = req.body;

    const ACTION_MAP = {
      CONTACT: "CONTACTED",
      CONFIRM: "CONFIRMED",
      MARK_FULFILLED: "FULFILLED",
      CANCEL: "CANCELLED",
      DECLINE: "DECLINED",
    };
    const newStatus = ACTION_MAP[action];
    if (!newStatus) return res.status(400).json({ success: false, message: "Unknown action." });

    const request = await PremiumRequest.findById(requestId);
    if (!request) return res.status(404).json({ success: false, message: "Request not found." });

    request.status = newStatus;
    request.statusHistory.push({ status: newStatus, action, byUserId: adminId, byRole: "ADMIN", note });
    if (newStatus === "FULFILLED") request.fulfilledAt = new Date();
    if (newStatus === "CANCELLED") request.cancelledAt = new Date();
    await request.save();

    res.json({ success: true, requestStatus: request.status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// â”€â”€â”€ Content management (venues & events) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const upsertVenue = async (req, res) => {
  try {
    const { venueId } = req.params;
    const data = req.body;
    let venue;
    if (venueId) {
      venue = await Venue.findByIdAndUpdate(venueId, { $set: data }, { new: true, runValidators: true });
    } else {
      venue = await Venue.create(data);
    }
    res.json({ success: true, venue });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const upsertEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const data = req.body;
    let event;
    if (eventId) {
      event = await Event.findByIdAndUpdate(eventId, { $set: data }, { new: true, runValidators: true });
    } else {
      event = await Event.create(data);
    }
    res.json({ success: true, event });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// â”€â”€â”€ Serializers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const serializeAdminBooking = (b) => ({
  ...b,
  userName: b.userId?.name,
  userPhone: b.userId?.phoneNumber,
  invitedMatchName: b.invitedMatchId?.name,
});

const serializeAdminTicketOrder = (o) => ({
  ...o,
  userName: o.userId?.name,
  userPhone: o.userId?.phoneNumber,
});

export default {
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
};

