import GiftIntent from "../models/GiftIntentModel.js";
import GiftOrder from "../models/GiftOrder.js";
import GiftPayment from "../models/GiftPaymentModel.js";
import notificationService from "../services/notificationService.js";
import { NOTIFICATION_TYPES } from "../services/notifications/notificationTypes.js";

// 🧮 Helper: single-payer model → sender pays 100%
const computePaymentShares = (intent) => {
  const total = Number(intent.totalAmount || 0);

  // In the current model:
  // - LOW, MID, HIGH → sender pays full amount
  // - recipient never pays
  return { sender: total, recipient: 0 };
};

// STEP 1: Initiate payment for a given intent (SENDER ONLY in this model)
export const initiateGiftPayment = async (req, res) => {
  try {
    const { intentId } = req.params;
    const userId = req.user.id;
    const { role: rawRole } = req.body; // optional hint from frontend

    console.log("💳 [PAY] initiateGiftPayment", {
      intentId,
      userId,
      rawRole,
    });

    const intent = await GiftIntent.findById(intentId);

    if (!intent) {
      return res
        .status(404)
        .json({ success: false, message: "Gift intent not found" });
    }

    // Only participants can touch this payment
    const senderIdStr = intent.senderId.toString();
    const recipientIdStr = intent.recipientId.toString();
    const userIdStr = userId.toString();

    if (![senderIdStr, recipientIdStr].includes(userIdStr)) {
      return res
        .status(403)
        .json({ success: false, message: "Not allowed for this intent" });
    }

    // Only allow payment in valid states
    if (["REJECTED", "EXPIRED", "CANCELLED"].includes(intent.status)) {
      return res.status(400).json({
        success: false,
        message: "Gift intent is not payable in current state",
      });
    }

    const shares = computePaymentShares(intent);

    // Decide role explicitly based on caller
    let role;
    if (userIdStr === senderIdStr) {
      role = "SENDER";
    } else if (userIdStr === recipientIdStr) {
      role = "RECIPIENT";
    } else {
      role = rawRole || "SENDER";
    }

    // 💰 Single-payer: only sender is allowed to pay
    if (role === "RECIPIENT") {
      return res.status(400).json({
        success: false,
        message: "Recipient payment is not required for this gift",
      });
    }

    const amount = shares.sender;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "No payable amount for this user",
      });
    }

    // If already paid, don't duplicate
    const existingPaid = await GiftPayment.findOne({
      giftIntentId: intent._id,
      userId,
      role,
      status: "PAID",
    });

    if (existingPaid) {
      return res.status(200).json({
        success: true,
        alreadyPaid: true,
        paymentId: existingPaid._id,
        amount: existingPaid.amount,
        currency: existingPaid.currency,
      });
    }

    // Create INITIATED record (gateway order will attach later)
    const payment = await GiftPayment.create({
      giftIntentId: intent._id,
      userId,
      role,
      amount,
      currency: "INR",
      provider: "RAZORPAY",
      status: "INITIATED",
    });

    console.log("💳 [PAY] Payment INITIATED", {
      paymentId: payment._id.toString(),
      role,
      amount,
    });

    // 👉 Frontend will now use `amount` to open Razorpay checkout etc.
    return res.status(201).json({
      success: true,
      paymentId: payment._id,
      amount,
      currency: "INR",
      role,
    });
  } catch (err) {
    console.error("🔥 [PAY] initiateGiftPayment error", err);
    return res.status(500).json({
      success: false,
      message: "Failed to initiate gift payment",
    });
  }
};

// STEP 2: Confirm a successful payment from frontend / webhook
export const confirmGiftPayment = async (req, res) => {
  try {
    const { intentId } = req.params;
    const userId = req.user.id;
    const {
      paymentId,
      providerPaymentId,
      status: requestedStatus,
      failureReason,
    } = req.body;

    console.log("💳 [PAY] confirmGiftPayment", {
      intentId,
      userId,
      paymentId,
      providerPaymentId,
      requestedStatus,
    });

    const payment = await GiftPayment.findById(paymentId);

    if (!payment) {
      return res
        .status(404)
        .json({ success: false, message: "Payment record not found" });
    }

    if (payment.giftIntentId.toString() !== intentId.toString()) {
      return res.status(400).json({
        success: false,
        message: "Payment does not belong to this intent",
      });
    }

    if (payment.userId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "You cannot confirm someone else's payment",
      });
    }

    if (payment.status === "PAID") {
      return res.status(200).json({
        success: true,
        alreadyConfirmed: true,
      });
    }

    const intent = await GiftIntent.findById(intentId);

    if (!intent) {
      return res
        .status(404)
        .json({ success: false, message: "Gift intent not found" });
    }

    const normalizedStatus = String(requestedStatus || "PAID").toUpperCase();

    if (normalizedStatus === "FAILED") {
      payment.status = "FAILED";
      payment.providerPaymentId = providerPaymentId || null;
      payment.failureReason = failureReason || "payment_failed";
      await payment.save();

      await notificationService.sendToUser(
        payment.userId,
        notificationService.buildNotificationPayload({
          type: NOTIFICATION_TYPES.GIFT_PAYMENT_FAILED,
          title: "Gift payment failed",
          body: "Your gift payment could not be completed.",
          data: {
            intentId: intent._id.toString(),
            chatId: intent.chatId?.toString?.() || intent.chatId,
            senderId: intent.senderId?.toString?.() || intent.senderId,
            recipientId: intent.recipientId?.toString?.() || intent.recipientId,
            paymentId: payment._id.toString(),
            screen: "GiftIntentDetailsScreen",
            extra: {
              failureReason: payment.failureReason,
            },
          },
        })
      );

      return res.status(200).json({
        success: true,
        paymentStatus: payment.status,
        intentStatus: intent.status,
        fullyPaid: false,
        orderId: null,
      });
    }

    // ✅ Mark payment as PAID (we trust Razorpay callback / frontend for now)
    payment.status = "PAID";
    payment.providerPaymentId = providerPaymentId || null;
    await payment.save();

    // 🔄 Update intent payment fields
    if (payment.role === "SENDER") {
      intent.senderPaidAmount = payment.amount;
      intent.senderPaidAt = new Date();
    } else if (payment.role === "RECIPIENT") {
      // Should not happen in current model, but kept for future safety
      intent.recipientPaidAmount = payment.amount;
      intent.recipientPaidAt = new Date();
    }

    // ✅ Single-payer model:
    // Gift is "fully paid" as soon as sender has paid.
    const senderDone =
      intent.senderPaidAmount && intent.senderPaidAmount > 0;

    const fullyPaid = !!senderDone;

    if (fullyPaid) {
      intent.status = "PAID";
    }

    await intent.save();

    // If fully paid, ensure a GiftOrder exists & store revenue data
    let order = null;

    if (fullyPaid) {
      order = await GiftOrder.findOne({ intentId: intent._id });

      if (!order) {
        const platformFee = Math.round(intent.totalAmount * 0.15); // 15% margin (tweak later)

        order = await GiftOrder.create({
          chatId: intent.chatId,
          intentId: intent._id,
          senderId: intent.senderId,
          recipientId: intent.recipientId,
          tier: intent.tier,
          items: intent.items, // items stored on intent
          source: "FUSE_MANUAL",
          totalAmount: intent.totalAmount,
          senderPaidAmount: intent.senderPaidAmount || 0,
          recipientPaidAmount: intent.recipientPaidAmount || 0,
          currency: "INR",
          platformFee,
          deliveryFee: 0,
          vendorCost: 0,
          status: "CREATED",
          // ❗ no deliverySnapshot / address exposed here from this controller
          note: "",
        });

        console.log("📦 [ORDER] GiftOrder created after full payment", {
          orderId: order._id.toString(),
          intentId: intent._id.toString(),
        });
      }
    }

    const successPayload = {
      type: NOTIFICATION_TYPES.GIFT_PAYMENT_SUCCESS,
      title: "Gift payment successful",
      body: "Your gift payment was completed successfully.",
      data: {
        intentId: intent._id.toString(),
        orderId: order?._id?.toString?.() || null,
        chatId: intent.chatId?.toString?.() || intent.chatId,
        senderId: intent.senderId?.toString?.() || intent.senderId,
        recipientId: intent.recipientId?.toString?.() || intent.recipientId,
        paymentId: payment._id.toString(),
        screen: order ? "GiftOrderTrackingScreen" : "GiftIntentDetailsScreen",
      },
    };

    await notificationService.sendToUser(
      payment.userId,
      notificationService.buildNotificationPayload(successPayload)
    );

    if (fullyPaid && intent.recipientId?.toString() !== payment.userId.toString()) {
      await notificationService.sendToUser(
        intent.recipientId,
        notificationService.buildNotificationPayload({
          ...successPayload,
          body: "A gift for you has been paid and is being processed.",
        })
      );
    }

    return res.status(200).json({
      success: true,
      paymentStatus: payment.status,
      intentStatus: intent.status,
      fullyPaid,
      orderId: order ? order._id : null,
    });
  } catch (err) {
    console.error("🔥 [PAY] confirmGiftPayment error", err);
    return res.status(500).json({
      success: false,
      message: "Failed to confirm gift payment",
    });
  }
};
