/**
 * Premium / concierge experience controller.
 * User submits a request â†’ ops contacts â†’ admin quotes â†’ user accepts + pays â†’ fulfilled.
 * HIGH tier items only; no instant self-serve payment.
 */
import PremiumRequest from "../models/PremiumRequest.js";
import Payment from "../models/Payment.js";
import { createPayment, verifyPayment } from "../services/paymentProvider.js";
import { alertNewPremiumRequest } from "../services/opsAlertService.js";
import notificationService from "../services/notificationService.js";
import { NOTIFICATION_TYPES } from "../services/notifications/notificationTypes.js";
import { logEvent } from "../services/analytics/logEvent.js";
import Block from "../models/Block.js";
import ChatModel from "../models/ChatModel.js";

// â”€â”€â”€ Submit premium request â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const submitPremiumRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { occasion, budget, notes, forMatchId } = req.body;

    if (!occasion || !budget) {
      return res.status(400).json({ success: false, message: "Occasion and budget are required." });
    }
    if (budget < 3000) {
      return res.status(400).json({
        success: false,
        message: "Premium requests start from â‚¹3,000.",
      });
    }

    // Validate match eligibility if for a match
    if (forMatchId) {
      const block = await Block.findOne({
        $or: [
          { blockerId: userId, blockedId: forMatchId },
          { blockerId: forMatchId, blockedId: userId },
        ],
      });
      if (block) {
        return res.status(400).json({ success: false, message: "Cannot send to a blocked user." });
      }
    }

    const request = await PremiumRequest.create({
      userId,
      occasion,
      budget,
      notes,
      forMatchId: forMatchId || undefined,
      requiresMatchApproval: !!forMatchId,
      matchApprovalStatus: forMatchId ? "PENDING" : null,
      status: "SUBMITTED",
      statusHistory: [{ status: "SUBMITTED", action: "SUBMITTED", byUserId: userId, byRole: "USER" }],
    });

    logEvent("premium_requested", userId, {
      requestId: request._id.toString(),
      occasion,
      budget,
    });

    alertNewPremiumRequest(request).catch(() => {});

    res.json({
      success: true,
      requestId: request._id,
      message:
        "Your premium request has been received. Our team will reach out to you shortly to plan your experience.",
    });
  } catch (err) {
    console.error("[PremiumController] submitPremiumRequest:", err);
    res.status(500).json({ success: false, message: "Could not submit request." });
  }
};

// â”€â”€â”€ Accept quote & pay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const initiatePremiumPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { requestId } = req.params;

    const request = await PremiumRequest.findById(requestId);
    if (!request) return res.status(404).json({ success: false, message: "Request not found." });
    if (String(request.userId) !== String(userId)) {
      return res.status(403).json({ success: false, message: "Not authorised." });
    }
    if (request.status !== "QUOTED") {
      return res.status(400).json({ success: false, message: "Quote not ready yet." });
    }
    if (!request.quotedAmount) {
      return res.status(400).json({ success: false, message: "No quote amount set." });
    }

    const existingPayment = await Payment.findOne({
      entityType: "PREMIUM",
      entityId: request._id,
      status: "INITIATED",
    });
    if (existingPayment) {
      return res.json({
        success: true,
        paymentId: existingPayment._id,
        amount: existingPayment.amount,
        mode: existingPayment.mode,
        providerOrderId: existingPayment.providerOrderId,
      });
    }

    const providerData = await createPayment({
      amount: request.quotedAmount,
      currency: "INR",
      receipt: request._id.toString(),
      notes: { occasion: request.occasion, userId: userId.toString() },
    });

    const payment = await Payment.create({
      userId,
      entityType: "PREMIUM",
      entityId: request._id,
      amount: request.quotedAmount,
      currency: "INR",
      mode: providerData.mode,
      provider: providerData.provider,
      providerOrderId: providerData.providerOrderId,
      idempotencyKey: request._id.toString(),
      status: "INITIATED",
    });

    request.status = "ACCEPTED";
    request.statusHistory.push({ status: "ACCEPTED", action: "QUOTE_ACCEPTED", byUserId: userId, byRole: "USER" });
    await request.save();

    res.json({
      success: true,
      paymentId: payment._id,
      amount: payment.amount,
      mode: payment.mode,
      providerOrderId: providerData.providerOrderId,
      keyId: providerData.keyId,
    });
  } catch (err) {
    console.error("[PremiumController] initiatePremiumPayment:", err);
    res.status(500).json({ success: false, message: "Could not initiate payment." });
  }
};

export const confirmPremiumPayment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { requestId } = req.params;
    const { paymentId, providerPaymentId, signature, status: clientStatus } = req.body;

    const [request, payment] = await Promise.all([
      PremiumRequest.findById(requestId),
      Payment.findById(paymentId),
    ]);

    if (!request || !payment) {
      return res.status(404).json({ success: false, message: "Request or payment not found." });
    }
    if (String(request.userId) !== String(userId)) {
      return res.status(403).json({ success: false, message: "Not authorised." });
    }
    if (payment.status === "PAID") {
      return res.json({ success: true, requestStatus: request.status, alreadyPaid: true });
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

    request.status = "PAID";
    request.finalAmount = request.quotedAmount;
    request.paymentId = payment._id;
    request.paidAt = new Date();
    request.statusHistory.push({ status: "PAID", action: "PAYMENT_CONFIRMED", byUserId: userId, byRole: "USER" });
    await request.save();

    notificationService
      .sendToUser(
        userId,
        notificationService.buildNotificationPayload({
          type: NOTIFICATION_TYPES.PREMIUM_CONFIRMED,
          body: "Your premium experience is all set! We'll handle the rest.",
          data: { requestId: request._id.toString() },
        })
      )
      .catch(() => {});

    res.json({ success: true, requestStatus: request.status });
  } catch (err) {
    console.error("[PremiumController] confirmPremiumPayment:", err);
    res.status(500).json({ success: false, message: "Could not confirm payment." });
  }
};

// â”€â”€â”€ List my requests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const getMyPremiumRequests = async (req, res) => {
  try {
    const userId = req.user.id;
    const requests = await PremiumRequest.find({ userId }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, requests: requests.map(serializePremiumRequest) });
  } catch (err) {
    console.error("[PremiumController] getMyPremiumRequests:", err);
    res.status(500).json({ success: false, message: "Could not load requests." });
  }
};

// â”€â”€â”€ Serializer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const serializePremiumRequest = (r) => ({
  _id: r._id,
  status: r.status,
  occasion: r.occasion,
  budget: r.budget,
  quotedAmount: r.status === "QUOTED" ? r.quotedAmount : null,
  quotedAt: r.quotedAt,
  finalAmount: r.finalAmount,
  createdAt: r.createdAt,
});

export default {
  submitPremiumRequest,
  initiatePremiumPayment,
  confirmPremiumPayment,
  getMyPremiumRequests,
};

