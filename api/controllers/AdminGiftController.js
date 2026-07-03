import GiftOrder from "../models/GiftOrder.js";
import notificationService from "../services/notificationService.js";
import { NOTIFICATION_TYPES } from "../services/notifications/notificationTypes.js";
import { serializeOrderForAdmin } from "../services/giftOrderService.js";

// Admin action -> target status
const ACTION_TO_STATUS = {
  APPROVE: "APPROVED",
  MARK_PROCESSING: "PROCESSING",
  MARK_FULFILLED: "FULFILLED",
  MARK_DELIVERED: "DELIVERED",
  CANCEL: "CANCELLED",
  MARK_REFUND_REQUIRED: "REFUND_REQUIRED",
  MARK_REFUNDED: "REFUNDED",
};

// Allowed transitions: from -> [allowed next statuses]
const ALLOWED_TRANSITIONS = {
  PAID: ["ADMIN_REVIEW"],
  ADMIN_REVIEW: ["APPROVED", "CANCELLED", "REFUND_REQUIRED"],
  APPROVED: ["PROCESSING", "CANCELLED", "REFUND_REQUIRED"],
  PROCESSING: ["FULFILLED", "CANCELLED", "REFUND_REQUIRED"],
  FULFILLED: ["DELIVERED", "REFUND_REQUIRED"],
  REFUND_REQUIRED: ["REFUNDED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
  REFUNDED: [],
};

const STATUS_TIMESTAMP_FIELD = {
  APPROVED: "approvedAt",
  PROCESSING: "processingAt",
  FULFILLED: "fulfilledAt",
  DELIVERED: "deliveredAt",
  CANCELLED: "cancelledAt",
  REFUND_REQUIRED: "refundRequiredAt",
  REFUNDED: "refundedAt",
};

// GET /api/admin/gifts/orders?status=&page=&limit=
export const getAdminGiftOrders = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) {
      filter.status = String(req.query.status).toUpperCase();
    }

    const [total, orders] = await Promise.all([
      GiftOrder.countDocuments(filter),
      GiftOrder.find(filter)
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
      orders: orders.map(serializeOrderForAdmin),
    });
  } catch (err) {
    console.error("🔥 [ADMIN] getAdminGiftOrders error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch orders" });
  }
};

// GET /api/admin/gifts/orders/:orderId
export const getAdminGiftOrderDetails = async (req, res) => {
  try {
    const order = await GiftOrder.findById(req.params.orderId)
      .populate("senderId", "name username photos")
      .populate("recipientId", "name username photos");

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Gift order not found" });
    }

    return res
      .status(200)
      .json({ success: true, order: serializeOrderForAdmin(order) });
  } catch (err) {
    console.error("🔥 [ADMIN] getAdminGiftOrderDetails error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch order" });
  }
};

const notifyParticipantsOfStatus = async (order, newStatus) => {
  const userIds = Array.from(
    new Set(
      [order.senderId?.toString?.(), order.recipientId?.toString?.()].filter(
        Boolean
      )
    )
  );

  let type = NOTIFICATION_TYPES.GIFT_ORDER_STATUS;
  if (newStatus === "REFUNDED" || newStatus === "REFUND_REQUIRED") {
    type = NOTIFICATION_TYPES.GIFT_REFUND_UPDATE;
  } else if (newStatus === "CANCELLED") {
    type = NOTIFICATION_TYPES.GIFT_ORDER_DECLINED;
  } else if (newStatus === "DELIVERED") {
    type = NOTIFICATION_TYPES.GIFT_ORDER_DELIVERED;
  }

  // Fire-and-forget — admin action must not fail due to push errors.
  notificationService
    .sendToUsers(
      userIds,
      notificationService.buildNotificationPayload({
        type,
        data: {
          orderId: order._id.toString(),
          chatId: String(order.chatId),
          screen: "GiftOrderTrackingScreen",
          extra: { status: newStatus },
        },
      })
    )
    .catch((e) => console.error("[GIFT] admin status notify failed", e));
};

// PATCH /api/admin/gifts/orders/:orderId/status  { action, trackingUrl?, vendorOrderId?, note? }
export const updateAdminGiftOrderStatus = async (req, res) => {
  try {
    const { action, trackingUrl, vendorOrderId, note } = req.body || {};

    const newStatus = ACTION_TO_STATUS[action];
    if (!newStatus) {
      return res.status(400).json({
        success: false,
        message: `Invalid action. Allowed: ${Object.keys(ACTION_TO_STATUS).join(", ")}`,
      });
    }

    const order = await GiftOrder.findById(req.params.orderId);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Gift order not found" });
    }

    const allowed = ALLOWED_TRANSITIONS[order.status] || [];
    if (!allowed.includes(newStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot move order from ${order.status} to ${newStatus}`,
      });
    }

    order.status = newStatus;
    const tsField = STATUS_TIMESTAMP_FIELD[newStatus];
    if (tsField && !order[tsField]) {
      order[tsField] = new Date();
    }
    if (typeof trackingUrl === "string") order.trackingUrl = trackingUrl;
    if (typeof vendorOrderId === "string") order.vendorOrderId = vendorOrderId;

    order.statusHistory.push({
      status: newStatus,
      action,
      byUserId: req.user.id,
      byRole: "ADMIN",
      note: note || "",
      at: new Date(),
    });

    await order.save();

    await notifyParticipantsOfStatus(order, newStatus);

    console.log("📦 [ADMIN] Order status updated", {
      orderId: order._id.toString(),
      action,
      status: newStatus,
      by: req.user.id,
    });

    return res.status(200).json({
      success: true,
      orderId: order._id,
      status: order.status,
    });
  } catch (err) {
    console.error("🔥 [ADMIN] updateAdminGiftOrderStatus error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update order status" });
  }
};

// PATCH /api/admin/gifts/orders/:orderId/notes  { notes }
export const updateAdminGiftOrderNotes = async (req, res) => {
  try {
    const { notes } = req.body || {};
    const order = await GiftOrder.findById(req.params.orderId);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Gift order not found" });
    }

    order.adminNotes = String(notes || "");
    await order.save();

    return res.status(200).json({
      success: true,
      orderId: order._id,
      adminNotes: order.adminNotes,
    });
  } catch (err) {
    console.error("🔥 [ADMIN] updateAdminGiftOrderNotes error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update notes" });
  }
};
