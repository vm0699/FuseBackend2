/**
 * Unified ops alert service for all Fuse Explore verticals, including gifting.
 * Channels: WhatsApp (Twilio) + Email (nodemailer) + Admin push (notificationService).
 *
 * All methods are fire-and-forget — they never throw or block callers.
 */
import { sendWhatsAppAlert } from "./opsAlert/whatsapp.js";
import { sendEmailAlert } from "./opsAlert/email.js";
import notificationService from "./notificationService.js";
import { NOTIFICATION_TYPES } from "./notifications/notificationTypes.js";

const getAdminUserIds = () =>
  String(process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const ADMIN_URL = process.env.ADMIN_WEB_URL || "https://admin.fusedating.co.in";

// ─── helpers ─────────────────────────────────────────────────────────────────

const tier = (order) => order?.tier || "—";
const amount = (order) => `₹${(order?.totalAmount || 0).toLocaleString("en-IN")}`;
const code = (order) => order?.orderCode || order?._id?.toString?.() || "—";

// ─── gift order ──────────────────────────────────────────────────────────────

export const alertNewGiftOrder = async (order) => {
  const summary = {
    type: "Gift",
    code: code(order),
    tier: tier(order),
    amount: amount(order),
    addressMissing: !!order?.addressMissing,
    at: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
  };

  const waMessage =
    `🎁 *New Gift Order* — ${summary.code}\n` +
    `Tier: ${summary.tier} | Amount: ${summary.amount}\n` +
    (summary.addressMissing ? "⚠️ Address missing — hold for review\n" : "") +
    `Time: ${summary.at}\n` +
    `Admin: ${ADMIN_URL}/orders/${order?._id}`;

  const emailHtml = buildEmailHtml("New Gift Order", summary, order?._id);

  await Promise.allSettled([
    sendWhatsAppAlert(waMessage),
    sendEmailAlert(`[Fuse] New Gift Order ${summary.code}`, emailHtml),
    notifyAdminPush("GIFT_ADMIN_NEW_ORDER", summary, order),
  ]);
};

/**
 * A UPI gift payment had a UTR submitted by the sender and needs manual
 * admin review (cross-check UTR + amount against the bank statement) before
 * an order is created — there is no order yet at this point, so this alert
 * carries the payment/intent directly rather than an order.
 */
export const alertUpiPaymentPendingVerification = async (payment, intent, { duplicateSuspected } = {}) => {
  const summary = {
    type: "UPI Gift Payment — Pending Verification",
    paymentId: payment?._id?.toString?.() || "—",
    amount: `₹${(payment?.amount || 0).toLocaleString("en-IN")}`,
    utr: payment?.upi?.submittedUtr || "—",
    duplicate: duplicateSuspected ? "⚠️ Duplicate UTR" : "No",
    at: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
  };

  const waMessage =
    `💳 *UPI Payment Needs Verification* — ${summary.paymentId}\n` +
    `Amount: ${summary.amount} | UTR: ${summary.utr}\n` +
    (duplicateSuspected ? "⚠️ Duplicate UTR — check carefully\n" : "") +
    `Time: ${summary.at}\n` +
    `Admin: ${ADMIN_URL}/gifts.html`;

  const emailHtml = buildEmailHtml("UPI Payment Needs Verification", summary, payment?._id);

  await Promise.allSettled([
    sendWhatsAppAlert(waMessage),
    sendEmailAlert(`[Fuse] UPI payment awaiting verification — ${summary.amount}`, emailHtml),
    notifyAdminPush("GIFT_ADMIN_NEW_ORDER", summary, payment),
  ]);
};

/**
 * Recipient declined a paid gift -> refund owed. Ops must see this or the
 * refund sits invisible (no gateway auto-refund exists yet — manual SOP).
 */
export const alertGiftRefundRequired = async (order) => {
  const summary = {
    type: "Gift refund",
    code: code(order),
    tier: tier(order),
    amount: amount(order),
    at: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
  };

  const waMessage =
    `💸 *Refund Owed* — ${summary.code}\n` +
    `Tier: ${summary.tier} | Amount: ${summary.amount}\n` +
    `Recipient declined a paid gift.\n` +
    `Time: ${summary.at}\n` +
    `Admin: ${ADMIN_URL}/orders/${order?._id}`;

  const emailHtml = buildEmailHtml("Refund Owed", summary, order?._id);

  await Promise.allSettled([
    sendWhatsAppAlert(waMessage),
    sendEmailAlert(`[Fuse] Refund Owed — ${summary.code}`, emailHtml),
    notifyAdminPush("GIFT_ADMIN_NEW_ORDER", summary, order),
  ]);
};

// ─── booking ─────────────────────────────────────────────────────────────────

export const alertNewBooking = async (booking) => {
  const summary = {
    type: "Date Booking",
    code: booking?.bookingCode || booking?._id?.toString?.() || "—",
    venue: booking?.venueName || "—",
    date: booking?.date ? new Date(booking.date).toLocaleDateString("en-IN") : "—",
    partySize: booking?.partySize || 1,
    amount: `₹${(booking?.totalAmount || 0).toLocaleString("en-IN")}`,
    at: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
  };

  const waMessage =
    `📅 *New Date Booking* — ${summary.code}\n` +
    `Venue: ${summary.venue} | Date: ${summary.date} | Party: ${summary.partySize}\n` +
    `Amount: ${summary.amount}\n` +
    `Time: ${summary.at}\n` +
    `Admin: ${ADMIN_URL}/bookings/${booking?._id}`;

  const emailHtml = buildEmailHtml("New Date Booking", summary, booking?._id);

  await Promise.allSettled([
    sendWhatsAppAlert(waMessage),
    sendEmailAlert(`[Fuse] New Booking ${summary.code}`, emailHtml),
    notifyAdminPush("EXPLORE_ADMIN_NEW_BOOKING", summary, booking),
  ]);
};

// ─── event ticket ─────────────────────────────────────────────────────────────

export const alertNewTicketOrder = async (ticketOrder) => {
  const summary = {
    type: "Event Ticket",
    code: ticketOrder?.ticketCode || ticketOrder?._id?.toString?.() || "—",
    event: ticketOrder?.eventName || "—",
    quantity: ticketOrder?.quantity || 1,
    amount: `₹${(ticketOrder?.totalAmount || 0).toLocaleString("en-IN")}`,
    at: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
  };

  const waMessage =
    `🎟️ *New Ticket Order* — ${summary.code}\n` +
    `Event: ${summary.event} | Qty: ${summary.quantity}\n` +
    `Amount: ${summary.amount}\n` +
    `Time: ${summary.at}\n` +
    `Admin: ${ADMIN_URL}/tickets/${ticketOrder?._id}`;

  const emailHtml = buildEmailHtml("New Ticket Order", summary, ticketOrder?._id);

  await Promise.allSettled([
    sendWhatsAppAlert(waMessage),
    sendEmailAlert(`[Fuse] New Ticket Order ${summary.code}`, emailHtml),
    notifyAdminPush("EXPLORE_ADMIN_NEW_TICKET", summary, ticketOrder),
  ]);
};

// ─── event capacity (Explore Iteration 2) ──────────────────────────────────────

export const alertEventCapacity = async (event) => {
  const summary = {
    type: "Event Nearing Capacity",
    event: event?.title || "—",
    going: `${event?.rsvpCount || 0} / ${event?.rsvpCap ?? "∞"}`,
    at: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
  };

  const waMessage =
    `🔥 *Event nearing capacity* — ${summary.event}\n` +
    `Going: ${summary.going}\n` +
    `Time: ${summary.at}\n` +
    `Admin: ${ADMIN_URL}/events/${event?._id}`;

  const emailHtml = buildEmailHtml("Event Nearing Capacity", summary, event?._id);

  await Promise.allSettled([
    sendWhatsAppAlert(waMessage),
    sendEmailAlert(`[Fuse] Event nearing capacity: ${summary.event}`, emailHtml),
  ]);
};

// ─── premium request ──────────────────────────────────────────────────────────

export const alertNewPremiumRequest = async (request) => {
  const summary = {
    type: "Premium Request",
    id: request?._id?.toString?.() || "—",
    occasion: request?.occasion || "—",
    budget: `₹${(request?.budget || 0).toLocaleString("en-IN")}`,
    at: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
  };

  const waMessage =
    `⭐ *New Premium Request* — ${summary.id}\n` +
    `Occasion: ${summary.occasion} | Budget: ${summary.budget}\n` +
    `Time: ${summary.at}\n` +
    `⚡ Requires manual follow-up!\n` +
    `Admin: ${ADMIN_URL}/premium/${request?._id}`;

  const emailHtml = buildEmailHtml("New Premium Request", summary, request?._id);

  await Promise.allSettled([
    sendWhatsAppAlert(waMessage),
    sendEmailAlert(`[Fuse] ⭐ Premium Request ${summary.id}`, emailHtml),
    notifyAdminPush("EXPLORE_ADMIN_NEW_PREMIUM", summary, request),
  ]);
};

// ─── internal helpers ─────────────────────────────────────────────────────────

const notifyAdminPush = async (type, summary, entity) => {
  try {
    const adminIds = getAdminUserIds();
    if (!adminIds.length) return;
    const typeMap = {
      GIFT_ADMIN_NEW_ORDER: NOTIFICATION_TYPES.GIFT_ADMIN_NEW_ORDER,
      EXPLORE_ADMIN_NEW_BOOKING: NOTIFICATION_TYPES.EXPLORE_ADMIN_NEW_BOOKING,
      EXPLORE_ADMIN_NEW_TICKET: NOTIFICATION_TYPES.EXPLORE_ADMIN_NEW_TICKET,
      EXPLORE_ADMIN_NEW_PREMIUM: NOTIFICATION_TYPES.EXPLORE_ADMIN_NEW_PREMIUM,
    };
    const notifType = typeMap[type] || NOTIFICATION_TYPES.ACCOUNT_ALERT;
    if (!NOTIFICATION_TYPES[notifType] && !Object.values(NOTIFICATION_TYPES).includes(notifType)) return;
    await notificationService.sendToUsers(
      adminIds,
      notificationService.buildNotificationPayload({
        type: notifType,
        title: `New ${summary.type}`,
        body: `${summary.code || summary.id} needs review.`,
        data: { entityId: entity?._id?.toString?.() },
      })
    );
  } catch {
    // silent
  }
};

const buildEmailHtml = (heading, summary, entityId) => `
<div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:24px;">
  <h2 style="color:#ff5864;">🎉 Fuse Ops — ${heading}</h2>
  <table style="width:100%;border-collapse:collapse;">
    ${Object.entries(summary)
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 8px;color:#555;font-size:13px;">${k}</td>
           <td style="padding:6px 8px;font-weight:600;font-size:13px;">${v}</td></tr>`
      )
      .join("")}
  </table>
  <p style="margin-top:20px;">
    <a href="${ADMIN_URL}/orders/${entityId}"
       style="background:#ff5864;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;">
      Open in Admin
    </a>
  </p>
  <p style="color:#aaa;font-size:11px;margin-top:16px;">Fuse Dating — automated ops alert</p>
</div>`;

export default {
  alertNewGiftOrder,
  alertUpiPaymentPendingVerification,
  alertGiftRefundRequired,
  alertNewBooking,
  alertNewTicketOrder,
  alertNewPremiumRequest,
  alertEventCapacity,
};
