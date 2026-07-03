import GiftOrder from "../models/GiftOrder.js";
import GiftPayment from "../models/GiftPaymentModel.js";
import notificationService from "../services/notificationService.js";
import { NOTIFICATION_TYPES } from "../services/notifications/notificationTypes.js";
import { serializeOrderForViewer } from "../services/giftOrderService.js";

// Recipient may decline only before fulfilment.
const DECLINABLE_STATUSES = ["PAID", "ADMIN_REVIEW", "APPROVED", "PROCESSING"];

// GET /api/chat/gifts/order/:orderId
export const getGiftOrderDetails = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await GiftOrder.findById(orderId)
      .populate("senderId", "name username photos")
      .populate("recipientId", "name username photos");

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Gift order not found" });
    }

    const senderStr =
      order.senderId?._id?.toString?.() || order.senderId?.toString?.();
    const recipientStr =
      order.recipientId?._id?.toString?.() || order.recipientId?.toString?.();

    if (![senderStr, recipientStr].includes(userId.toString())) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized to view this order" });
    }

    return res.status(200).json({
      success: true,
      order: serializeOrderForViewer(order, userId),
    });
  } catch (err) {
    console.error("🔥 [GIFT] getGiftOrderDetails error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch gift order" });
  }
};

// GET /api/chat/gifts/sent
export const getSentGifts = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 50);
    const skip = (page - 1) * limit;

    const [total, orders] = await Promise.all([
      GiftOrder.countDocuments({ senderId: userId }),
      GiftOrder.find({ senderId: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("senderId", "name username photos")
        .populate("recipientId", "name username photos"),
    ]);

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      orders: orders.map((o) => serializeOrderForViewer(o, userId)),
    });
  } catch (err) {
    console.error("🔥 [GIFT] getSentGifts error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch sent gifts" });
  }
};

// GET /api/chat/gifts/received
export const getReceivedGifts = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10), 1), 50);
    const skip = (page - 1) * limit;

    const [total, orders] = await Promise.all([
      GiftOrder.countDocuments({ recipientId: userId }),
      GiftOrder.find({ recipientId: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("senderId", "name username photos")
        .populate("recipientId", "name username photos"),
    ]);

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      orders: orders.map((o) => serializeOrderForViewer(o, userId)),
    });
  } catch (err) {
    console.error("🔥 [GIFT] getReceivedGifts error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch received gifts" });
  }
};

/**
 * POST /api/gifts/orders/:orderId/decline
 * Recipient declines a paid gift before fulfilment.
 *  - if a successful payment exists -> REFUND_REQUIRED
 *  - otherwise -> CANCELLED
 * Sender is notified with status only (no reason).
 */
export const declineGiftOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await GiftOrder.findById(orderId);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Gift order not found" });
    }

    // Only the recipient can decline.
    if (order.recipientId.toString() !== userId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Only the recipient can decline this gift" });
    }

    if (!DECLINABLE_STATUSES.includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: "This gift can no longer be declined",
      });
    }

    const paidPayment = await GiftPayment.findOne({
      giftIntentId: order.intentId,
      status: "PAID",
    });

    const now = new Date();
    const newStatus = paidPayment ? "REFUND_REQUIRED" : "CANCELLED";
    order.status = newStatus;
    if (newStatus === "REFUND_REQUIRED") {
      order.refundRequiredAt = now;
    } else {
      order.cancelledAt = now;
    }
    order.statusHistory.push({
      status: newStatus,
      action: "RECIPIENT_DECLINED",
      byUserId: userId,
      byRole: "RECIPIENT",
      at: now,
    });
    await order.save();

    // Notify sender — status only, no recipient reason. Fire-and-forget.
    notificationService
      .sendToUser(
        order.senderId,
        notificationService.buildNotificationPayload({
          type: NOTIFICATION_TYPES.GIFT_ORDER_DECLINED,
          data: {
            orderId: order._id.toString(),
            chatId: String(order.chatId),
            screen: "GiftOrderTrackingScreen",
          },
        })
      )
      .catch((e) => console.error("[GIFT] decline notify failed", e));

    return res.status(200).json({
      success: true,
      orderId: order._id,
      status: order.status,
    });
  } catch (err) {
    console.error("🔥 [GIFT] declineGiftOrder error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to decline gift order" });
  }
};
