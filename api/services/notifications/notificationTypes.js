export const NOTIFICATION_TYPES = {
  COMPLIMENT_RECEIVED: "COMPLIMENT_RECEIVED",
  COMPLIMENT_ACCEPTED: "COMPLIMENT_ACCEPTED",
  COMPLIMENT_REJECTED: "COMPLIMENT_REJECTED",
  CHAT_MESSAGE: "CHAT_MESSAGE",
  GIFT_INTENT_RECEIVED: "GIFT_INTENT_RECEIVED",
  GIFT_INTENT_ACCEPTED: "GIFT_INTENT_ACCEPTED",
  GIFT_INTENT_REJECTED: "GIFT_INTENT_REJECTED",
  GIFT_PAYMENT_SUCCESS: "GIFT_PAYMENT_SUCCESS",
  GIFT_PAYMENT_FAILED: "GIFT_PAYMENT_FAILED",
  GIFT_ORDER_DISPATCHED: "GIFT_ORDER_DISPATCHED",
  GIFT_ORDER_DELIVERED: "GIFT_ORDER_DELIVERED",
  VIDEO_CALL_INVITE: "VIDEO_CALL_INVITE",
  VIDEO_CALL_MISSED: "VIDEO_CALL_MISSED",
  ACCOUNT_ALERT: "ACCOUNT_ALERT",
};

export const NOTIFICATION_DEFAULTS = {
  [NOTIFICATION_TYPES.COMPLIMENT_RECEIVED]: {
    title: "New compliment",
    body: "Someone sent you a compliment.",
    screen: "ChatScreen",
  },
  [NOTIFICATION_TYPES.COMPLIMENT_ACCEPTED]: {
    title: "Compliment accepted",
    body: "Your compliment was accepted. Start the conversation.",
    screen: "ChatScreen",
  },
  [NOTIFICATION_TYPES.COMPLIMENT_REJECTED]: {
    title: "Compliment declined",
    body: "Your compliment request was declined.",
    screen: "Liked You",
  },
  [NOTIFICATION_TYPES.CHAT_MESSAGE]: {
    title: "New message",
    body: "You have a new message.",
    screen: "ChatScreen",
  },
  [NOTIFICATION_TYPES.GIFT_INTENT_RECEIVED]: {
    title: "Gift request received",
    body: "You received a gift intent.",
    screen: "GiftIntentDetailsScreen",
  },
  [NOTIFICATION_TYPES.GIFT_INTENT_ACCEPTED]: {
    title: "Gift accepted",
    body: "Your gift intent was accepted.",
    screen: "GiftIntentDetailsScreen",
  },
  [NOTIFICATION_TYPES.GIFT_INTENT_REJECTED]: {
    title: "Gift declined",
    body: "Your gift intent was declined.",
    screen: "GiftIntentDetailsScreen",
  },
  [NOTIFICATION_TYPES.GIFT_PAYMENT_SUCCESS]: {
    title: "Gift payment successful",
    body: "Your gift payment was completed successfully.",
    screen: "GiftOrderTrackingScreen",
  },
  [NOTIFICATION_TYPES.GIFT_PAYMENT_FAILED]: {
    title: "Gift payment failed",
    body: "Your gift payment could not be completed.",
    screen: "GiftIntentDetailsScreen",
  },
  [NOTIFICATION_TYPES.GIFT_ORDER_DISPATCHED]: {
    title: "Gift dispatched",
    body: "Your gift order is on the way.",
    screen: "GiftOrderTrackingScreen",
  },
  [NOTIFICATION_TYPES.GIFT_ORDER_DELIVERED]: {
    title: "Gift delivered",
    body: "Your gift order was delivered.",
    screen: "GiftOrderTrackingScreen",
  },
  [NOTIFICATION_TYPES.VIDEO_CALL_INVITE]: {
    title: "Incoming video call",
    body: "Someone wants to start a video call.",
    screen: "VideoInitiateScreen",
  },
  [NOTIFICATION_TYPES.VIDEO_CALL_MISSED]: {
    title: "Missed video call",
    body: "You missed a video call.",
    screen: "VideoInitiateScreen",
  },
  [NOTIFICATION_TYPES.ACCOUNT_ALERT]: {
    title: "Important update",
    body: "Please review this important account update.",
    screen: "NotificationSettings",
  },
};

export const buildNotificationPayload = ({
  type,
  title,
  body,
  data = {},
}) => {
  if (!type || !NOTIFICATION_DEFAULTS[type]) {
    throw new Error(`Unsupported notification type: ${type}`);
  }

  const defaults = NOTIFICATION_DEFAULTS[type];

  return {
    type,
    title: title || defaults.title,
    body: body || defaults.body,
    data: {
      type,
      screen: data.screen || defaults.screen,
      ...data,
      type,
    },
  };
};
