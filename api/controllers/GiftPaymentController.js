import GiftIntent from "../models/GiftIntentModel.js";
import GiftOrder from "../models/GiftOrder.js";
import GiftPayment from "../models/GiftPaymentModel.js";
import UserProfile from "../models/UserProfile.js";
import notificationService from "../services/notificationService.js";
import { NOTIFICATION_TYPES } from "../services/notifications/notificationTypes.js";
import {
  getGiftPaymentMode,
  createGiftPayment,
  verifyGiftPayment,
} from "../services/giftPaymentProvider.js";
import {
  generateOrderCode,
  isDeliveryAddressUsable,
} from "../services/giftOrderService.js";
import { notifyAdminsNewOrder } from "../services/adminAlertService.js";

/**
 * STEP 1 — Initiate payment for an intent (SENDER ONLY, payment-first MVP).
 *
 * Idempotent: a retry/double-tap reuses the existing payment record for the
 * intent (keyed by idempotencyKey = intentId) rather than creating a second.
 */
export const initiateGiftPayment = async (req, res) => {
  try {
    const { intentId } = req.params;
    const userId = req.user.id;

    const intent = await GiftIntent.findById(intentId);
    if (!intent) {
      return res
        .status(404)
        .json({ success: false, message: "Gift intent not found" });
    }

    // Only the sender may pay.
    if (intent.senderId.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Only the sender can pay for this gift" });
    }

    // Payment-first: intent must be freshly CREATED.
    if (intent.status !== "CREATED") {
      return res.status(400).json({
        success: false,
        message: "This gift is not payable in its current state",
      });
    }

    const amount = Number(intent.totalAmount || 0);
    if (!amount || amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid gift amount" });
    }

    const idempotencyKey = intent._id.toString();

    // Reuse any existing payment for this intent.
    const existing = await GiftPayment.findOne({ idempotencyKey });
    if (existing) {
      if (existing.status === "PAID") {
        return res.status(200).json({
          success: true,
          alreadyPaid: true,
          paymentId: existing._id,
          amount: existing.amount,
          currency: existing.currency,
          mode: existing.mode,
          providerOrderId: existing.providerOrderId || null,
        });
      }
      // Return the in-flight record again.
      return res.status(200).json({
        success: true,
        paymentId: existing._id,
        amount: existing.amount,
        currency: existing.currency,
        mode: existing.mode,
        providerOrderId: existing.providerOrderId || null,
      });
    }

    // Ask the provider adapter to create an order (placeholder or razorpay).
    const providerResult = await createGiftPayment({
      amount,
      currency: "INR",
      intentId: intent._id.toString(),
    });

    const payment = await GiftPayment.create({
      giftIntentId: intent._id,
      userId,
      role: "SENDER",
      amount,
      currency: "INR",
      mode: providerResult.mode,
      provider: providerResult.provider,
      providerOrderId: providerResult.providerOrderId,
      idempotencyKey,
      status: "INITIATED",
    });

    return res.status(201).json({
      success: true,
      paymentId: payment._id,
      amount,
      currency: "INR",
      mode: payment.mode,
      providerOrderId: payment.providerOrderId || null,
      razorpayKeyId:
        payment.mode === "RAZORPAY" ? process.env.RAZORPAY_KEY_ID || null : null,
    });
  } catch (err) {
    console.error("🔥 [PAY] initiateGiftPayment error", err);
    return res.status(500).json({
      success: false,
      message: "Failed to initiate gift payment",
    });
  }
};

/**
 * STEP 2 — Confirm payment and create the order in ADMIN_REVIEW.
 *
 * On success: payment->PAID, intent->PAID, GiftOrder created idempotently with a
 * frozen recipient address snapshot (sender never sees it), admin alerted.
 */
export const confirmGiftPayment = async (req, res) => {
  try {
    const { intentId } = req.params;
    const userId = req.user.id;
    const {
      paymentId,
      providerPaymentId,
      signature,
      status: requestedStatus,
      failureReason,
    } = req.body || {};

    const payment = await GiftPayment.findById(paymentId);
    if (!payment) {
      return res
        .status(404)
        .json({ success: false, message: "Payment record not found" });
    }

    if (payment.giftIntentId.toString() !== intentId.toString()) {
      return res
        .status(400)
        .json({ success: false, message: "Payment does not belong to this intent" });
    }

    // Sender-only.
    if (payment.userId.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "You cannot confirm this payment" });
    }

    const intent = await GiftIntent.findById(intentId);
    if (!intent) {
      return res
        .status(404)
        .json({ success: false, message: "Gift intent not found" });
    }

    // Idempotent confirm: if already paid, return the existing order.
    if (payment.status === "PAID") {
      const existingOrder = await GiftOrder.findOne({ intentId: intent._id });
      return res.status(200).json({
        success: true,
        alreadyConfirmed: true,
        intentStatus: intent.status,
        order: existingOrder
          ? { _id: existingOrder._id, orderCode: existingOrder.orderCode, status: existingOrder.status }
          : null,
      });
    }

    const mode = getGiftPaymentMode();
    const normalizedStatus = String(requestedStatus || "PAID").toUpperCase();

    // Explicit client-reported failure.
    if (normalizedStatus === "FAILED") {
      payment.status = "FAILED";
      payment.providerPaymentId = providerPaymentId || null;
      payment.failureReason = failureReason || "payment_failed";
      await payment.save();

      await notificationService.sendToUser(
        payment.userId,
        notificationService.buildNotificationPayload({
          type: NOTIFICATION_TYPES.GIFT_PAYMENT_FAILED,
          data: {
            intentId: intent._id.toString(),
            chatId: String(intent.chatId),
            paymentId: payment._id.toString(),
            screen: "GiftIntentDetailsScreen",
          },
        })
      );

      return res.status(200).json({
        success: true,
        paymentStatus: payment.status,
        intentStatus: intent.status,
        order: null,
      });
    }

    // Verify with the provider adapter (placeholder trusts; razorpay checks HMAC).
    const verification = await verifyGiftPayment({
      providerOrderId: payment.providerOrderId,
      providerPaymentId,
      signature,
    });

    if (!verification.verified) {
      payment.status = "FAILED";
      payment.failureReason = "verification_failed";
      await payment.save();
      return res.status(400).json({
        success: false,
        message: "Payment verification failed",
      });
    }

    // Mark payment PAID.
    payment.status = "PAID";
    payment.providerPaymentId = verification.providerPaymentId || providerPaymentId || null;
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

      // Fire admin alert without blocking the response.
      notifyAdminsNewOrder(order).catch((e) =>
        console.error("[GIFT] admin alert failed", e)
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

    return res.status(200).json({
      success: true,
      paymentStatus: payment.status,
      intentStatus: intent.status,
      order: {
        _id: order._id,
        orderCode: order.orderCode,
        status: order.status,
      },
    });
  } catch (err) {
    console.error("🔥 [PAY] confirmGiftPayment error", err);
    return res.status(500).json({
      success: false,
      message: "Failed to confirm gift payment",
    });
  }
};
