import GiftOrder from "../models/GiftOrder.js";
import UserProfile from "../models/UserProfile.js";
import notificationService from "./notificationService.js";
import { NOTIFICATION_TYPES } from "./notifications/notificationTypes.js";
import { getGiftPaymentMode } from "./giftPaymentProvider.js";
import { generateOrderCode, isDeliveryAddressUsable } from "./giftOrderService.js";
import { alertNewGiftOrder } from "./opsAlertService.js";

/**
 * Shared finalize step, called after a payment is confirmed successful —
 * by the client's confirm call, the Razorpay webhook, or an admin manually
 * verifying a UPI payment's submitted UTR. Whichever trigger arrives first
 * wins; the others are safe no-ops thanks to the idempotency guards here.
 *
 * Marks payment/intent PAID, creates the GiftOrder idempotently with a frozen
 * recipient address snapshot (sender never sees it), fires the ops alert, and
 * notifies both participants. Returns the order (existing or newly created).
 */
export const finalizeGiftPayment = async ({ payment, intent, providerPaymentId }) => {
  const mode = payment.mode || getGiftPaymentMode();

  // Mark payment PAID.
  payment.status = "PAID";
  payment.providerPaymentId = providerPaymentId || payment.providerPaymentId || null;
  payment.verifiedAt = new Date();
  payment.meta = { ...(payment.meta || {}), mode };
  await payment.save();

  // Mark intent PAID.
  intent.status = "PAID";
  intent.senderPaidAmount = payment.amount;
  intent.senderPaidAt = new Date();
  await intent.save();

  // Create the order once (idempotent on intentId).
  let order = await GiftOrder.findOne({ intentId: intent._id });
  if (!order) {
    // Freeze recipient delivery address (never exposed to sender).
    const recipientProfile = await UserProfile.findById(intent.recipientId).select(
      "deliveryAddress phoneNumber name"
    );
    const addr = recipientProfile?.deliveryAddress || {};
    const addressMissing = !isDeliveryAddressUsable(addr);

    const deliverySnapshot = {
      name: addr.name || recipientProfile?.name || "",
      phone: addr.phone || recipientProfile?.phoneNumber || "",
      line1: addr.line1 || "",
      line2: addr.line2 || "",
      city: addr.city || "",
      state: addr.state || "",
      pincode: addr.pincode || "",
      landmark: addr.landmark || "",
      label: addr.label || "",
    };

    const snap = intent.catalogSnapshot || {};

    order = await GiftOrder.create({
      chatId: intent.chatId,
      intentId: intent._id,
      paymentId: payment._id,
      orderCode: generateOrderCode(),
      senderId: intent.senderId,
      recipientId: intent.recipientId,
      tier: intent.tier,
      catalogItemId: intent.catalogItemId || null,
      items: intent.items,
      source: "FUSE_MANUAL",
      totalAmount: intent.totalAmount,
      senderPaidAmount: intent.senderPaidAmount || 0,
      currency: "INR",
      platformFee: Number(snap.platformFee || 0),
      deliveryFee: Number(snap.deliveryFee || 0),
      vendorCost: 0,
      status: "ADMIN_REVIEW",
      addressMissing,
      deliverySnapshot,
      statusHistory: [
        {
          status: "PAID",
          action: "PAYMENT_CONFIRMED",
          byUserId: intent.senderId,
          byRole: "SENDER",
          at: new Date(),
        },
        {
          status: "ADMIN_REVIEW",
          action: "AUTO_SUBMITTED",
          byRole: "SYSTEM",
          note: addressMissing ? "Recipient address missing — held for review" : "",
          at: new Date(),
        },
      ],
    });

    // Fire ops alert (email + WhatsApp + admin push) without blocking the caller.
    alertNewGiftOrder(order).catch((e) =>
      console.error("[GIFT] ops alert failed", e)
    );
  }

  // Notify sender + recipient — fire-and-forget so a push failure never
  // causes a 500 after the order is already persisted.
  notificationService
    .sendToUser(
      intent.senderId,
      notificationService.buildNotificationPayload({
        type: NOTIFICATION_TYPES.GIFT_PAYMENT_SUCCESS,
        data: {
          intentId: intent._id.toString(),
          orderId: order._id.toString(),
          chatId: String(intent.chatId),
          paymentId: payment._id.toString(),
          screen: "GiftOrderTrackingScreen",
        },
      })
    )
    .catch((e) => console.error("[GIFT] sender notify failed", e));

  if (intent.recipientId.toString() !== intent.senderId.toString()) {
    notificationService
      .sendToUser(
        intent.recipientId,
        notificationService.buildNotificationPayload({
          type: NOTIFICATION_TYPES.GIFT_ORDER_STATUS,
          title: "You have a gift! 🎁",
          body: "Someone sent you a gift. It's being processed.",
          data: {
            orderId: order._id.toString(),
            chatId: String(intent.chatId),
            screen: "GiftOrderTrackingScreen",
          },
        })
      )
      .catch((e) => console.error("[GIFT] recipient notify failed", e));
  }

  return order;
};

export default { finalizeGiftPayment };
