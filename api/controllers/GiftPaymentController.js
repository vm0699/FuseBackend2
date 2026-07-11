import crypto from "crypto";
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
import { alertNewGiftOrder } from "../services/opsAlertService.js";

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
 * Shared finalize step, called after a payment is verified as successful —
 * either by the client's confirm call or by the Razorpay webhook (whichever
 * arrives first; the other is a no-op thanks to the idempotency guards here).
 *
 * Marks payment/intent PAID, creates the GiftOrder idempotently with a frozen
 * recipient address snapshot (sender never sees it), fires the ops alert, and
 * notifies both participants. Returns the order (existing or newly created).
 */
const finalizeGiftPayment = async ({ payment, intent, providerPaymentId }) => {
  const mode = getGiftPaymentMode();

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

/**
 * STEP 2 — Confirm payment and create the order in ADMIN_REVIEW.
 *
 * On success: payment->PAID, intent->PAID, GiftOrder created idempotently with a
 * frozen recipient address snapshot (sender never sees it), admin alerted.
 *
 * Note: for RAZORPAY mode this is a client-reported confirmation, verified by
 * HMAC. The webhook handler below (handleGiftRazorpayWebhook) is the
 * authoritative, server-to-server confirmation and reaches the same idempotent
 * finalizeGiftPayment — whichever arrives first "wins"; the other is a no-op.
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

    const order = await finalizeGiftPayment({
      payment,
      intent,
      providerPaymentId: verification.providerPaymentId || providerPaymentId || null,
    });

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

/**
 * POST /api/gifts/razorpay/webhook
 *
 * Server-to-server, authoritative confirmation from Razorpay — the robust
 * counterpart to the client's confirmGiftPayment call above (which can be
 * skipped entirely if the app crashes/closes right after payment). Both paths
 * converge on the same finalizeGiftPayment, so whichever arrives first wins
 * and the other is a safe no-op.
 *
 * Must be mounted with express.raw() (see GiftRoutes.js / server.js) — the
 * signature is computed over the exact raw request bytes, not the parsed body.
 */
export const handleGiftRazorpayWebhook = async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("[GIFT WEBHOOK] RAZORPAY_WEBHOOK_SECRET not set — rejecting.");
      return res.status(500).json({ success: false });
    }

    const signature = req.headers["x-razorpay-signature"];
    const rawBody = req.body; // Buffer, thanks to express.raw() on this route.
    if (!signature || !Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ success: false, message: "Missing signature or body" });
    }

    const expected = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    const validSignature =
      expected.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));

    if (!validSignature) {
      console.error("[GIFT WEBHOOK] Invalid signature — rejecting.");
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    const event = JSON.parse(rawBody.toString("utf8"));
    const eventType = event?.event;

    // Only gift-payment events matter here; the same Razorpay account may
    // fire webhooks for other Fuse Explore verticals too — ack and ignore.
    if (eventType !== "payment.captured" && eventType !== "payment.failed") {
      return res.status(200).json({ success: true, ignored: true });
    }

    const paymentEntity = event?.payload?.payment?.entity;
    const providerOrderId = paymentEntity?.order_id;
    const providerPaymentId = paymentEntity?.id;
    if (!providerOrderId) {
      return res.status(200).json({ success: true, ignored: true });
    }

    const payment = await GiftPayment.findOne({ providerOrderId });
    if (!payment) {
      // Not a gift payment (could belong to another vertical on the same
      // Razorpay account) — ack so Razorpay stops retrying.
      return res.status(200).json({ success: true, ignored: true });
    }

    if (eventType === "payment.failed") {
      if (payment.status === "INITIATED") {
        payment.status = "FAILED";
        payment.providerPaymentId = providerPaymentId || null;
        payment.failureReason = "razorpay_webhook_failed";
        await payment.save();

        notificationService
          .sendToUser(
            payment.userId,
            notificationService.buildNotificationPayload({
              type: NOTIFICATION_TYPES.GIFT_PAYMENT_FAILED,
              data: {
                intentId: payment.giftIntentId.toString(),
                paymentId: payment._id.toString(),
                screen: "GiftIntentDetailsScreen",
              },
            })
          )
          .catch((e) => console.error("[GIFT WEBHOOK] failure notify failed", e));
      }
      return res.status(200).json({ success: true });
    }

    // payment.captured — idempotent: no-op if already finalized by the
    // client's own confirm call.
    if (payment.status === "PAID") {
      return res.status(200).json({ success: true, alreadyConfirmed: true });
    }

    const intent = await GiftIntent.findById(payment.giftIntentId);
    if (!intent) {
      console.error("[GIFT WEBHOOK] Payment found but intent missing", {
        paymentId: payment._id.toString(),
      });
      return res.status(200).json({ success: true, ignored: true });
    }

    await finalizeGiftPayment({ payment, intent, providerPaymentId });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("🔥 [GIFT WEBHOOK] handleGiftRazorpayWebhook error", err);
    // 500 so Razorpay retries per its standard webhook retry policy.
    return res.status(500).json({ success: false });
  }
};
