import crypto from "crypto";

/**
 * Centralized gift-order helpers: order code generation, sender-safe status
 * labels, and role-aware serialization.
 *
 * CRITICAL PRIVACY RULE: the full delivery address (line1/line2/phone/pincode)
 * must NEVER be returned to participants. Only admin serialization exposes it.
 * All participant-facing responses go through serializeOrderForViewer, which
 * only ever surfaces city/state/label.
 */

export const SENDER_SAFE_STATUS_LABELS = {
  CREATED: "Created",
  PAID: "Payment received",
  ADMIN_REVIEW: "Under admin review",
  APPROVED: "Approved",
  PROCESSING: "Being prepared",
  FULFILLED: "Fulfilled by Fuse",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUND_REQUIRED: "Refund required",
  REFUNDED: "Refunded",
};

// Recipient may decline only before the gift is fulfilled/delivered/terminal.
const RECIPIENT_DECLINABLE_STATUSES = [
  "PAID",
  "ADMIN_REVIEW",
  "APPROVED",
  "PROCESSING",
];

export const statusLabel = (status) =>
  SENDER_SAFE_STATUS_LABELS[status] || status || "";

export const generateOrderCode = () => {
  // FUSE-G-XXXXXX (uppercase, unambiguous-ish base32-like)
  const raw = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `FUSE-G-${raw.slice(0, 6)}`;
};

// Only safe address metadata — never the full address.
export const buildDeliveryPublicView = (deliverySnapshot = {}) => ({
  city: deliverySnapshot?.city || null,
  state: deliverySnapshot?.state || null,
  label: deliverySnapshot?.label || null,
});

const mapCounterpart = (profile) => ({
  id: profile?._id || profile || null,
  name: profile?.name || "",
  username: profile?.username || "",
  photo:
    Array.isArray(profile?.photos) && profile.photos.length > 0
      ? profile.photos[0]
      : null,
});

const mapItems = (items = []) =>
  (items || []).map((it) => ({
    itemId: it.itemId,
    name: it.name,
    quantity: it.quantity,
    price: it.price,
    source: it.source,
  }));

/**
 * Participant-facing serializer. `viewerId` decides perspective.
 * Returns NO full address — only public city/state/label.
 */
export const serializeOrderForViewer = (order, viewerId) => {
  const senderStr =
    order.senderId?._id?.toString?.() || order.senderId?.toString?.();
  const recipientStr =
    order.recipientId?._id?.toString?.() || order.recipientId?.toString?.();
  const viewerStr = viewerId?.toString?.();

  const perspective = senderStr === viewerStr ? "SENDER" : "RECIPIENT";
  const counterpart =
    perspective === "SENDER" ? order.recipientId : order.senderId;

  const canDecline =
    perspective === "RECIPIENT" &&
    RECIPIENT_DECLINABLE_STATUSES.includes(order.status);

  return {
    orderId: order._id,
    orderCode: order.orderCode || null,
    intentId: order.intentId || null,
    chatId: order.chatId,
    tier: order.tier || null,
    totalAmount: order.totalAmount,
    currency: order.currency || "INR",
    status: order.status,
    statusLabel: statusLabel(order.status),
    perspective,
    canDecline,
    items: mapItems(order.items),
    tracking: {
      status: order.status,
      statusLabel: statusLabel(order.status),
      trackingUrl: order.trackingUrl || null,
      approvedAt: order.approvedAt || null,
      processingAt: order.processingAt || null,
      fulfilledAt: order.fulfilledAt || null,
      dispatchedAt: order.dispatchedAt || null,
      deliveredAt: order.deliveredAt || null,
      cancelledAt: order.cancelledAt || null,
      refundRequiredAt: order.refundRequiredAt || null,
      refundedAt: order.refundedAt || null,
    },
    // Safe address metadata only.
    delivery: buildDeliveryPublicView(order.deliverySnapshot),
    counterpart: mapCounterpart(counterpart),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
};

/**
 * Admin-facing serializer — exposes the FULL delivery snapshot and history.
 * Only ever used behind adminMiddleware.
 */
export const serializeOrderForAdmin = (order) => ({
  orderId: order._id,
  orderCode: order.orderCode || null,
  intentId: order.intentId || null,
  paymentId: order.paymentId || null,
  chatId: order.chatId,
  tier: order.tier || null,
  totalAmount: order.totalAmount,
  currency: order.currency || "INR",
  platformFee: order.platformFee || 0,
  deliveryFee: order.deliveryFee || 0,
  status: order.status,
  statusLabel: statusLabel(order.status),
  addressMissing: !!order.addressMissing,
  items: mapItems(order.items),
  deliverySnapshot: order.deliverySnapshot || null, // FULL address (admin only)
  statusHistory: order.statusHistory || [],
  adminNotes: order.adminNotes || "",
  trackingUrl: order.trackingUrl || null,
  vendorOrderId: order.vendorOrderId || null,
  sender: mapCounterpart(order.senderId),
  recipient: mapCounterpart(order.recipientId),
  createdAt: order.createdAt,
  updatedAt: order.updatedAt,
});

export const isDeliveryAddressUsable = (address = {}) =>
  Boolean(
    address &&
      (address.line1 || address.line2) &&
      address.city &&
      address.pincode
  );

export default {
  SENDER_SAFE_STATUS_LABELS,
  statusLabel,
  generateOrderCode,
  buildDeliveryPublicView,
  serializeOrderForViewer,
  serializeOrderForAdmin,
  isDeliveryAddressUsable,
};
