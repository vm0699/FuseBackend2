/**
 * Event ticket controller â€” Stage 5 vertical.
 * Handles: purchase ticket, confirm payment, list/detail orders.
 * Admin fulfils by attaching ticket reference. Address revealed after FULFILLED.
 */
import Event from "../models/Event.js";
import EventTicketOrder from "../models/EventTicketOrder.js";
import Payment from "../models/Payment.js";
import { createPayment, verifyPayment } from "../services/paymentProvider.js";
import { alertNewTicketOrder } from "../services/opsAlertService.js";
import notificationService from "../services/notificationService.js";
import { NOTIFICATION_TYPES } from "../services/notifications/notificationTypes.js";
import { logEvent } from "../services/analytics/logEvent.js";

// â”€â”€â”€ Purchase ticket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const initiateTicketPurchase = async (req, res) => {
  try {
    const userId = req.user.id;
    const { eventId, quantity = 1 } = req.body;

    const event = await Event.findOne({ _id: eventId, isActive: true });
    if (!event) return res.status(404).json({ success: false, message: "Event not found." });
    if (!event.eventDate || event.eventDate < new Date()) {
      return res.status(400).json({ success: false, message: "Event has already passed." });
    }

    const qty = Math.min(Math.max(1, Number(quantity)), event.maxPerOrder || 4);
    const available = (event.totalSlots || 0) - (event.soldSlots || 0);
    if (available < qty) {
      return res.status(400).json({ success: false, message: "Not enough tickets available." });
    }

    const totalAmount = event.ticketPrice * qty;

    const order = await EventTicketOrder.create({
      userId,
      eventId: event._id,
      eventSnapshot: {
        title: event.title,
        venue: event.venue,
        city: event.city,
        address: event.address,     // revealed to user after FULFILLED
        eventDate: event.eventDate,
        ticketPrice: event.ticketPrice,
      },
      quantity: qty,
      totalAmount,
      status: "CREATED",
      statusHistory: [{ status: "CREATED", action: "CREATED", byUserId: userId, byRole: "USER" }],
      city: event.city,
    });

    const providerData = await createPayment({
      amount: totalAmount,
      currency: "INR",
      receipt: order._id.toString(),
      notes: { eventTitle: event.title, userId: userId.toString() },
    });

    const payment = await Payment.create({
      userId,
      entityType: "EVENT_TICKET",
      entityId: order._id,
      amount: totalAmount,
      currency: "INR",
      mode: providerData.mode,
      provider: providerData.provider,
      providerOrderId: providerData.providerOrderId,
      idempotencyKey: order._id.toString(),
      status: "INITIATED",
    });

    logEvent("ticket_started", userId, { eventId: event._id.toString(), quantity: qty });

    res.json({
      success: true,
      orderId: order._id,
      paymentId: payment._id,
      amount: totalAmount,
      currency: "INR",
      mode: providerData.mode,
      providerOrderId: providerData.providerOrderId,
      keyId: providerData.keyId,
    });
  } catch (err) {
    console.error("[EventController] initiateTicketPurchase:", err);
    res.status(500).json({ success: false, message: "Could not initiate ticket purchase." });
  }
};

// â”€â”€â”€ Confirm ticket payment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const confirmTicketPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;
    const { paymentId, providerPaymentId, signature, status: clientStatus } = req.body;

    const [order, payment] = await Promise.all([
      EventTicketOrder.findById(orderId),
      Payment.findById(paymentId),
    ]);

    if (!order || !payment) {
      return res.status(404).json({ success: false, message: "Order or payment not found." });
    }
    if (String(order.userId) !== String(userId)) {
      return res.status(403).json({ success: false, message: "Not authorised." });
    }
    if (payment.status === "PAID") {
      return res.json({ success: true, orderStatus: order.status, alreadyPaid: true });
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

    order.status = "CONFIRMED";
    order.paymentId = payment._id;
    order.paidAt = new Date();
    order.statusHistory.push({ status: "CONFIRMED", action: "PAYMENT_CONFIRMED", byUserId: userId, byRole: "USER" });
    await order.save();

    // Reserve slots atomically
    await Event.findByIdAndUpdate(order.eventId, { $inc: { soldSlots: order.quantity } });

    logEvent("ticket_confirmed", userId, { orderId: order._id.toString() });

    alertNewTicketOrder({
      ...order.toObject(),
      eventName: order.eventSnapshot?.title,
    }).catch(() => {});

    notificationService
      .sendToUser(
        userId,
        notificationService.buildNotificationPayload({
          type: NOTIFICATION_TYPES.TICKET_CONFIRMED,
          body: `Your ticket for "${order.eventSnapshot?.title}" is confirmed!`,
          data: { orderId: order._id.toString() },
        })
      )
      .catch(() => {});

    res.json({ success: true, orderStatus: order.status, order: serializeTicketOrder(order) });
  } catch (err) {
    console.error("[EventController] confirmTicketPayment:", err);
    res.status(500).json({ success: false, message: "Could not confirm ticket payment." });
  }
};

// â”€â”€â”€ List & detail â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getMyTicketOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20 } = req.query;
    const orders = await EventTicketOrder.find({ userId })
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();
    res.json({ success: true, orders: orders.map(serializeTicketOrder) });
  } catch (err) {
    console.error("[EventController] getMyTicketOrders:", err);
    res.status(500).json({ success: false, message: "Could not load ticket orders." });
  }
};

export const getTicketOrderDetail = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;
    const order = await EventTicketOrder.findById(orderId).lean();
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    if (String(order.userId) !== String(userId)) {
      return res.status(403).json({ success: false, message: "Not authorised." });
    }
    res.json({ success: true, order: serializeTicketOrder(order) });
  } catch (err) {
    console.error("[EventController] getTicketOrderDetail:", err);
    res.status(500).json({ success: false, message: "Could not load order." });
  }
};

// â”€â”€â”€ Serializer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const serializeTicketOrder = (o) => ({
  _id: o._id,
  ticketCode: o.ticketCode,
  status: o.status,
  eventTitle: o.eventSnapshot?.title,
  eventVenue: o.eventSnapshot?.venue,
  eventCity: o.eventSnapshot?.city,
  // Reveal event address only after FULFILLED (admin has attached tickets)
  eventAddress: o.status === "FULFILLED" ? o.eventSnapshot?.address : null,
  eventDate: o.eventSnapshot?.eventDate,
  quantity: o.quantity,
  totalAmount: o.totalAmount,
  ticketReference: o.status === "FULFILLED" ? o.ticketReference : null,
  ticketAttachment: o.status === "FULFILLED" ? o.ticketAttachment : null,
  createdAt: o.createdAt,
});

export default {
  initiateTicketPurchase,
  confirmTicketPayment,
  getMyTicketOrders,
  getTicketOrderDetail,
};

