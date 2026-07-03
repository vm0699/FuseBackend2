import notificationService from "./notificationService.js";
import { NOTIFICATION_TYPES } from "./notifications/notificationTypes.js";

/**
 * Admin alerting for new paid gift orders.
 *
 * MVP: log a structured console alert + push-notify any admin user IDs that
 * have the app installed. Structured so an email/Slack provider can be added
 * later without touching callers.
 */
const getAdminUserIds = () =>
  String(process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const notifyAdminsNewOrder = async (order) => {
  try {
    const summary = {
      orderId: order?._id?.toString?.(),
      orderCode: order?.orderCode || null,
      tier: order?.tier || null,
      totalAmount: order?.totalAmount,
      addressMissing: !!order?.addressMissing,
      at: new Date().toISOString(),
    };

    console.log("🛎️ [ADMIN ALERT] New gift order needs review:", summary);

    const adminIds = getAdminUserIds();
    if (adminIds.length) {
      await notificationService.sendToUsers(
        adminIds,
        notificationService.buildNotificationPayload({
          type: NOTIFICATION_TYPES.GIFT_ADMIN_NEW_ORDER,
          title: "New gift order",
          body: `Order ${summary.orderCode || summary.orderId} (${
            summary.tier
          }) needs review.`,
          data: {
            orderId: summary.orderId,
            screen: "GiftOrderTrackingScreen",
          },
        })
      );
    }
  } catch (error) {
    // Never let alerting failures break the payment flow.
    console.error("⚠️ [ADMIN ALERT] failed:", error.message);
  }
};

export default { notifyAdminsNewOrder };
