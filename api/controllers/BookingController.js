/**
 * Date booking controller â€” Stage 4 vertical.
 * Handles: create booking, initiate payment, confirm payment,
 * invite-a-match, accept/decline invite, cancel, list (sent/received).
 */
import Booking from "../models/Booking.js";
import Venue from "../models/Venue.js";
import Payment from "../models/Payment.js";
import UserProfile from "../models/UserProfile.js";
import { createPayment, verifyPayment } from "../services/paymentProvider.js";
import { alertNewBooking } from "../services/opsAlertService.js";
import notificationService from "../services/notificationService.js";
import { NOTIFICATION_TYPES } from "../services/notifications/notificationTypes.js";
import { logEvent } from "../services/analytics/logEvent.js";
import Block from "../models/Block.js";
import ChatModel from "../models/ChatModel.js";

const INVITE_EXPIRY_HOURS = 48;

// â”€â”€â”€ Create booking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const createBooking = async (req, res) => {
  try {
    const userId = req.user.id;
    const { venueId, date, timeSlot, partySize = 2, specialNotes, inviteMatchId } = req.body;

    const venue = await Venue.findOne({ _id: venueId, isActive: true });
    if (!venue) return res.status(404).json({ success: false, message: "Venue not found." });

    if (partySize > venue.maxPartySize) {
      return res.status(400).json({
        success: false,
        message: `This venue supports up to ${venue.maxPartySize} guests.`,
      });
    }

    // Validate invited match eligibility
    if (inviteMatchId) {
      const eligible = await checkMatchEligibility(userId, inviteMatchId);
      if (!eligible.ok) {
        return res.status(400).json({ success: false, message: eligible.reason });
      }
    }

    const inviteExpiresAt = inviteMatchId
      ? new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000)
      : undefined;

    const booking = await Booking.create({
      userId,
      venueId: venue._id,
      venueSnapshot: {
        name: venue.name,
        area: venue.area,
        city: venue.city,
        address: venue.address,    // stored in snapshot; revealed after CONFIRMED
        bookingFee: venue.bookingFee,
        dinerDiscountPct: venue.venueCommissionPct > 0 ? venue.dinerDiscountPct : 0,
      },
      date: new Date(date),
      timeSlot,
      partySize,
      specialNotes,
      totalAmount: venue.bookingFee,
      invitedMatchId: inviteMatchId || undefined,
      inviteStatus: inviteMatchId ? "PENDING" : null,
      inviteExpiresAt,
      status: inviteMatchId ? "INVITE_PENDING" : "CREATED",
      statusHistory: [
        {
          status: inviteMatchId ? "INVITE_PENDING" : "CREATED",
          action: "CREATED",
          byUserId: userId,
          byRole: "USER",
        },
      ],
      city: venue.city,
    });

    logEvent("booking_started", userId, { venueId: venue._id.toString(), hasInvite: !!inviteMatchId });

    if (inviteMatchId) {
      notificationService
        .sendToUser(
          inviteMatchId,
          notificationService.buildNotificationPayload({
            type: NOTIFICATION_TYPES.BOOKING_INVITE_RECEIVED,
            body: "Someone wants to take you on a date!",
            data: { bookingId: booking._id.toString() },
          })
        )
        .catch(() => {});
    }

    res.json({ success: true, bookingId: booking._id, booking: serializeBooking(booking, userId) });
  } catch (err) {
    console.error("[BookingController] createBooking:", err);
    res.status(500).json({ success: false, message: "Could not create booking." });
  }
};

// â”€â”€â”€ Initiate payment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const initiateBookingPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bookingId } = req.params;

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });
    if (String(booking.userId) !== String(userId)) {
      return res.status(403).json({ success: false, message: "Not authorised." });
    }
    if (!["CREATED", "INVITE_PENDING"].includes(booking.status)) {
      return res.status(400).json({ success: false, message: "Booking is not in a payable state." });
    }

    // Idempotency: reuse existing INITIATED payment if present
    const existingPayment = await Payment.findOne({
      entityType: "BOOKING",
      entityId: booking._id,
      status: "INITIATED",
    });
    if (existingPayment) {
      return res.json({
        success: true,
        paymentId: existingPayment._id,
        amount: existingPayment.amount,
        currency: existingPayment.currency,
        mode: existingPayment.mode,
        providerOrderId: existingPayment.providerOrderId,
      });
    }

    const providerData = await createPayment({
      amount: booking.totalAmount,
      currency: "INR",
      receipt: booking._id.toString(),
    });

    const payment = await Payment.create({
      userId,
      entityType: "BOOKING",
      entityId: booking._id,
      amount: booking.totalAmount,
      currency: "INR",
      mode: providerData.mode,
      provider: providerData.provider,
      providerOrderId: providerData.providerOrderId,
      idempotencyKey: booking._id.toString(),
      status: "INITIATED",
    });

    logEvent("booking_payment_initiated", userId, { bookingId: booking._id.toString() });

    res.json({
      success: true,
      paymentId: payment._id,
      amount: payment.amount,
      currency: payment.currency,
      mode: payment.mode,
      providerOrderId: providerData.providerOrderId,
      keyId: providerData.keyId,
    });
  } catch (err) {
    console.error("[BookingController] initiateBookingPayment:", err);
    res.status(500).json({ success: false, message: "Could not initiate payment." });
  }
};

// â”€â”€â”€ Confirm payment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const confirmBookingPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bookingId } = req.params;
    const { paymentId, providerPaymentId, signature, status: clientStatus } = req.body;

    const [booking, payment] = await Promise.all([
      Booking.findById(bookingId),
      Payment.findById(paymentId),
    ]);

    if (!booking || !payment) {
      return res.status(404).json({ success: false, message: "Booking or payment not found." });
    }
    if (String(booking.userId) !== String(userId)) {
      return res.status(403).json({ success: false, message: "Not authorised." });
    }
    if (payment.status === "PAID") {
      return res.json({ success: true, bookingStatus: booking.status, alreadyPaid: true });
    }

    if (clientStatus === "failed") {
      payment.status = "FAILED";
      payment.failureReason = "Client reported failure";
      await payment.save();
      return res.json({ success: true, paymentStatus: "FAILED" });
    }

    const { verified, providerPaymentId: verifiedPaymentId } = await verifyPayment({
      providerOrderId: payment.providerOrderId,
      providerPaymentId,
      signature,
    });

    if (!verified) {
      payment.status = "FAILED";
      payment.failureReason = "Signature verification failed";
      await payment.save();
      return res.status(400).json({ success: false, message: "Payment verification failed." });
    }

    payment.status = "PAID";
    payment.providerPaymentId = verifiedPaymentId;
    payment.verifiedAt = new Date();
    await payment.save();

    booking.status = "CONFIRMED";
    booking.paymentId = payment._id;
    booking.paidAt = new Date();
    booking.statusHistory.push({
      status: "CONFIRMED",
      action: "PAYMENT_CONFIRMED",
      byUserId: userId,
      byRole: "USER",
    });
    await booking.save();

    logEvent("booking_confirmed", userId, { bookingId: booking._id.toString() });

    // Ops alert (fire-and-forget)
    alertNewBooking({
      ...booking.toObject(),
      venueName: booking.venueSnapshot?.name,
    }).catch(() => {});

    // Notify invited match if any
    if (booking.invitedMatchId && booking.inviteStatus === "PENDING") {
      notificationService
        .sendToUser(
          booking.invitedMatchId,
          notificationService.buildNotificationPayload({
            type: NOTIFICATION_TYPES.BOOKING_INVITE_RECEIVED,
            body: "A date is booked for you! Check it out.",
            data: { bookingId: booking._id.toString() },
          })
        )
        .catch(() => {});
    }

    res.json({
      success: true,
      bookingStatus: booking.status,
      booking: serializeBooking(booking, userId),
    });
  } catch (err) {
    console.error("[BookingController] confirmBookingPayment:", err);
    res.status(500).json({ success: false, message: "Could not confirm payment." });
  }
};

// â”€â”€â”€ Invite accept/decline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const respondToInvite = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bookingId } = req.params;
    const { action } = req.body; // "ACCEPT" | "DECLINE"

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });
    if (String(booking.invitedMatchId) !== String(userId)) {
      return res.status(403).json({ success: false, message: "Not the invited match." });
    }
    if (booking.inviteStatus !== "PENDING") {
      return res.status(400).json({ success: false, message: "Invite is no longer pending." });
    }
    if (booking.inviteExpiresAt && booking.inviteExpiresAt < new Date()) {
      booking.inviteStatus = "EXPIRED";
      await booking.save();
      return res.status(400).json({ success: false, message: "Invite has expired." });
    }

    if (action === "ACCEPT") {
      booking.inviteStatus = "ACCEPTED";
      booking.statusHistory.push({
        status: booking.status,
        action: "INVITE_ACCEPTED",
        byUserId: userId,
        byRole: "MATCH",
      });
      // Track match-to-date conversion
      logEvent("match_to_date_conversion", userId, { bookingId: booking._id.toString() });

      notificationService
        .sendToUser(
          booking.userId,
          notificationService.buildNotificationPayload({
            type: NOTIFICATION_TYPES.BOOKING_INVITE_ACCEPTED,
            body: "Your match accepted the date invite!",
            data: { bookingId: booking._id.toString() },
          })
        )
        .catch(() => {});
    } else {
      booking.inviteStatus = "DECLINED";
      booking.statusHistory.push({
        status: booking.status,
        action: "INVITE_DECLINED",
        byUserId: userId,
        byRole: "MATCH",
      });
      notificationService
        .sendToUser(
          booking.userId,
          notificationService.buildNotificationPayload({
            type: NOTIFICATION_TYPES.BOOKING_INVITE_DECLINED,
            body: "Your match declined the date invite.",
            data: { bookingId: booking._id.toString() },
          })
        )
        .catch(() => {});
    }

    await booking.save();
    res.json({ success: true, inviteStatus: booking.inviteStatus });
  } catch (err) {
    console.error("[BookingController] respondToInvite:", err);
    res.status(500).json({ success: false, message: "Could not respond to invite." });
  }
};

// â”€â”€â”€ Cancel booking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const cancelBooking = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bookingId } = req.params;

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });
    if (String(booking.userId) !== String(userId)) {
      return res.status(403).json({ success: false, message: "Not authorised." });
    }
    if (["CANCELLED", "REFUNDED", "REFUND_REQUIRED"].includes(booking.status)) {
      return res.status(400).json({ success: false, message: "Booking already cancelled." });
    }

    const wasConfirmed = booking.status === "CONFIRMED";
    booking.status = wasConfirmed ? "REFUND_REQUIRED" : "CANCELLED";
    booking.cancelledAt = new Date();
    booking.statusHistory.push({
      status: booking.status,
      action: "USER_CANCELLED",
      byUserId: userId,
      byRole: "USER",
    });
    await booking.save();

    res.json({ success: true, bookingStatus: booking.status });
  } catch (err) {
    console.error("[BookingController] cancelBooking:", err);
    res.status(500).json({ success: false, message: "Could not cancel booking." });
  }
};

// â”€â”€â”€ List my bookings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getMyBookings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const bookings = await Booking.find({
      $or: [{ userId }, { invitedMatchId: userId }],
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    res.json({ success: true, bookings: bookings.map((b) => serializeBooking(b, userId)) });
  } catch (err) {
    console.error("[BookingController] getMyBookings:", err);
    res.status(500).json({ success: false, message: "Could not load bookings." });
  }
};

export const getBookingDetail = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bookingId } = req.params;
    const booking = await Booking.findById(bookingId).lean();
    if (!booking) return res.status(404).json({ success: false, message: "Booking not found." });
    const isParticipant =
      String(booking.userId) === String(userId) ||
      String(booking.invitedMatchId) === String(userId);
    if (!isParticipant) return res.status(403).json({ success: false, message: "Not authorised." });
    res.json({ success: true, booking: serializeBooking(booking, userId) });
  } catch (err) {
    console.error("[BookingController] getBookingDetail:", err);
    res.status(500).json({ success: false, message: "Could not load booking." });
  }
};

// â”€â”€â”€ Internal helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const checkMatchEligibility = async (userId, matchId) => {
  const block = await Block.findOne({
    $or: [
      { blockerId: userId, blockedId: matchId },
      { blockerId: matchId, blockedId: userId },
    ],
  });
  if (block) return { ok: false, reason: "Cannot invite a blocked user." };

  const chat = await ChatModel.findOne({
    $or: [
      { senderId: userId, receiverId: matchId },
      { senderId: matchId, receiverId: userId },
    ],
    status: "accepted",
  });
  if (!chat) return { ok: false, reason: "You must have an accepted chat to invite this match." };

  // Respect recipient's date invite preference
  const match = await UserProfile.findById(matchId).select("safetyPreferences").lean();
  if (match?.safetyPreferences?.allowDateInvites === false) {
    return { ok: false, reason: "This person is not accepting date invites right now." };
  }

  return { ok: true };
};

const serializeBooking = (b, viewerId) => {
  const isOwner = String(b.userId) === String(viewerId);
  const isConfirmed = ["CONFIRMED", "ADMIN_REVIEW", "FULFILLED"].includes(b.status);
  return {
    _id: b._id,
    bookingCode: b.bookingCode,
    status: b.status,
    date: b.date,
    timeSlot: b.timeSlot,
    partySize: b.partySize,
    venueName: b.venueSnapshot?.name,
    venueArea: b.venueSnapshot?.area,
    // Only reveal full address after confirmation
    venueAddress: isConfirmed ? b.venueSnapshot?.address : null,
    venueCity: b.venueSnapshot?.city,
    bookingFee: b.venueSnapshot?.bookingFee,
    dinerDiscountPct: b.venueSnapshot?.dinerDiscountPct,
    totalAmount: b.totalAmount,
    inviteStatus: b.inviteStatus,
    inviteExpiresAt: b.inviteExpiresAt,
    specialNotes: isOwner ? b.specialNotes : null,
    isOwner,
    createdAt: b.createdAt,
  };
};

export default {
  createBooking,
  initiateBookingPayment,
  confirmBookingPayment,
  respondToInvite,
  cancelBooking,
  getMyBookings,
  getBookingDetail,
};

