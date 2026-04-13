import GiftOrder from "../models/GiftOrder.js";
import notificationService from "../services/notificationService.js";
import { NOTIFICATION_TYPES } from "../services/notifications/notificationTypes.js";

// Small helper so we never expose full address
const buildDeliveryPublicView = (deliverySnapshot = {}) => ({
  city: deliverySnapshot.city || null,
  state: deliverySnapshot.state || null,
  label: deliverySnapshot.label || null,
});

const mapOrderForList = (order, perspective = "SENDER") => {
  const sender = order.senderId;
  const recipient = order.recipientId;

  const counterpart =
    perspective === "SENDER" ? recipient : sender;

  return {
    orderId: order._id,
    intentId: order.intentId || null,
    chatId: order.chatId,
    tier: order.tier || null,
    totalAmount: order.totalAmount,
    currency: order.currency,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,

    items: order.items.map((it) => ({
      itemId: it.itemId,
      name: it.name,
      quantity: it.quantity,
      price: it.price,
      source: it.source,
    })),

    tracking: {
      status: order.status,
      trackingUrl: order.trackingUrl || null,
      dispatchedAt: order.dispatchedAt || null,
      deliveredAt: order.deliveredAt || null,
    },

    delivery: buildDeliveryPublicView(order.deliverySnapshot),

    counterpart: {
      id: counterpart?._id || null,
      name: counterpart?.name || "",
      username: counterpart?.username || "",
      photo:
        Array.isArray(counterpart?.photos) &&
        counterpart.photos.length > 0
          ? counterpart.photos[0]
          : null,
    },
  };
};

export const getGiftOrderDetails = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;

    const order = await GiftOrder.findById(orderId)
      .populate("senderId", "name username photos")
      .populate("recipientId", "name username photos");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Gift order not found",
      });
    }

    const userIdStr = userId.toString();
    const senderStr = order.senderId?._id?.toString?.() || order.senderId?.toString?.();
    const recipientStr =
      order.recipientId?._id?.toString?.() || order.recipientId?.toString?.();

    if (![senderStr, recipientStr].includes(userIdStr)) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this order",
      });
    }

    const perspective = senderStr === userIdStr ? "SENDER" : "RECIPIENT";

    return res.status(200).json({
      success: true,
      order: mapOrderForList(order, perspective),
    });
  } catch (err) {
    console.error("🔥 [GIFT] getGiftOrderDetails error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch gift order",
    });
  }
};

// GET /api/chat/gifts/sent
export const getSentGifts = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10), 1),
      50
    );
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

    const data = orders.map((o) => mapOrderForList(o, "SENDER"));

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      orders: data,
    });
  } catch (err) {
    console.error("🔥 [GIFT] getSentGifts error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch sent gifts",
    });
  }
};

// GET /api/chat/gifts/received
export const getReceivedGifts = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10), 1),
      50
    );
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

    const data = orders.map((o) => mapOrderForList(o, "RECIPIENT"));

    return res.status(200).json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      orders: data,
    });
  } catch (err) {
    console.error("🔥 [GIFT] getReceivedGifts error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch received gifts",
    });
  }
};

// PATCH /api/chat/gifts/order/:orderId/status
export const updateGiftOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.user.id;
    const { status, trackingUrl, vendorOrderId } = req.body;

    const allowedStatuses = [
      "CREATED",
      "PROCESSING",
      "DISPATCHED",
      "DELIVERED",
      "FAILED",
      "CANCELLED",
    ];

    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid or missing status value",
      });
    }

    const order = await GiftOrder.findById(orderId);

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Gift order not found" });
    }

    const userIdStr = userId.toString();
    const senderStr = order.senderId.toString();
    const recipientStr = order.recipientId.toString();

    // For now: only participants can update in Postman tests.
    // Later: this can be restricted to admin / ops.
    if (![senderStr, recipientStr].includes(userIdStr)) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this order",
      });
    }

    order.status = status;

    if (typeof trackingUrl === "string") {
      order.trackingUrl = trackingUrl;
    }

    if (typeof vendorOrderId === "string") {
      order.vendorOrderId = vendorOrderId;
    }

    const now = new Date();
    if (status === "DISPATCHED" && !order.dispatchedAt) {
      order.dispatchedAt = now;
    }
    if (status === "DELIVERED" && !order.deliveredAt) {
      order.deliveredAt = now;
    }
    if (
      (status === "FAILED" || status === "CANCELLED") &&
      !order.cancelledAt
    ) {
      order.cancelledAt = now;
    }

    await order.save();

    const notificationTypeByStatus = {
      DISPATCHED: NOTIFICATION_TYPES.GIFT_ORDER_DISPATCHED,
      DELIVERED: NOTIFICATION_TYPES.GIFT_ORDER_DELIVERED,
    };

    const notificationType = notificationTypeByStatus[status];
    if (notificationType) {
      const userIdsToNotify = Array.from(
        new Set([
          order.senderId?.toString?.() || order.senderId,
          order.recipientId?.toString?.() || order.recipientId,
        ].filter(Boolean))
      );

      await notificationService.sendToUsers(
        userIdsToNotify,
        notificationService.buildNotificationPayload({
          type: notificationType,
          data: {
            orderId: order._id.toString(),
            intentId: order.intentId?.toString?.() || order.intentId || null,
            chatId: order.chatId?.toString?.() || order.chatId,
            senderId: order.senderId?.toString?.() || order.senderId,
            recipientId: order.recipientId?.toString?.() || order.recipientId,
            screen: "GiftOrderTrackingScreen",
            extra: {
              trackingUrl: order.trackingUrl || null,
              status: order.status,
            },
          },
        })
      );
    }

    console.log("📦 [GIFT] Order status updated", {
      orderId: order._id.toString(),
      status: order.status,
    });

    return res.status(200).json({
      success: true,
      orderId: order._id,
      status: order.status,
      trackingUrl: order.trackingUrl,
      dispatchedAt: order.dispatchedAt,
      deliveredAt: order.deliveredAt,
      cancelledAt: order.cancelledAt,
    });
  } catch (err) {
    console.error("🔥 [GIFT] updateGiftOrderStatus error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update gift order status",
    });
  }
};
