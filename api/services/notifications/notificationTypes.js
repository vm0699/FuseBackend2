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
  GIFT_ORDER_STATUS: "GIFT_ORDER_STATUS",
  GIFT_ORDER_DECLINED: "GIFT_ORDER_DECLINED",
  GIFT_REFUND_UPDATE: "GIFT_REFUND_UPDATE",
  GIFT_ADMIN_NEW_ORDER: "GIFT_ADMIN_NEW_ORDER",
  VIDEO_CALL_INVITE: "VIDEO_CALL_INVITE",
  VIDEO_CALL_MISSED: "VIDEO_CALL_MISSED",
  ACCOUNT_ALERT: "ACCOUNT_ALERT",

  // Fuse Explore — bookings
  BOOKING_CONFIRMED: "BOOKING_CONFIRMED",
  BOOKING_INVITE_RECEIVED: "BOOKING_INVITE_RECEIVED",
  BOOKING_INVITE_ACCEPTED: "BOOKING_INVITE_ACCEPTED",
  BOOKING_INVITE_DECLINED: "BOOKING_INVITE_DECLINED",
  BOOKING_INVITE_EXPIRED: "BOOKING_INVITE_EXPIRED",
  BOOKING_CANCELLED: "BOOKING_CANCELLED",
  BOOKING_EXPIRING_SOON: "BOOKING_EXPIRING_SOON",

  // Fuse Explore — event tickets
  TICKET_CONFIRMED: "TICKET_CONFIRMED",
  EVENT_REMINDER: "EVENT_REMINDER",
  TICKET_FULFILLED: "TICKET_FULFILLED",

  // Fuse Explore — premium
  PREMIUM_QUOTE_READY: "PREMIUM_QUOTE_READY",
  PREMIUM_CONFIRMED: "PREMIUM_CONFIRMED",

  // Fuse Explore — admin alerts
  EXPLORE_ADMIN_NEW_BOOKING: "EXPLORE_ADMIN_NEW_BOOKING",
  EXPLORE_ADMIN_NEW_TICKET: "EXPLORE_ADMIN_NEW_TICKET",
  EXPLORE_ADMIN_NEW_PREMIUM: "EXPLORE_ADMIN_NEW_PREMIUM",
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
  [NOTIFICATION_TYPES.GIFT_ORDER_STATUS]: {
    title: "Gift update",
    body: "There's an update on your gift order.",
    screen: "GiftOrderTrackingScreen",
  },
  [NOTIFICATION_TYPES.GIFT_ORDER_DECLINED]: {
    title: "Gift declined",
    body: "Your gift could not be delivered.",
    screen: "GiftOrderTrackingScreen",
  },
  [NOTIFICATION_TYPES.GIFT_REFUND_UPDATE]: {
    title: "Refund update",
    body: "There's an update on your gift refund.",
    screen: "GiftOrderTrackingScreen",
  },
  [NOTIFICATION_TYPES.GIFT_ADMIN_NEW_ORDER]: {
    title: "New gift order",
    body: "A new gift order needs review.",
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

  // Explore — bookings
  [NOTIFICATION_TYPES.BOOKING_CONFIRMED]: {
    title: "Booking confirmed",
    body: "Your date booking is confirmed.",
    screen: "MyBookingsScreen",
  },
  [NOTIFICATION_TYPES.BOOKING_INVITE_RECEIVED]: {
    title: "Date invite",
    body: "Someone invited you on a date!",
    screen: "BookingCheckoutScreen",
  },
  [NOTIFICATION_TYPES.BOOKING_INVITE_ACCEPTED]: {
    title: "Invite accepted",
    body: "Your match accepted your date invite.",
    screen: "MyBookingsScreen",
  },
  [NOTIFICATION_TYPES.BOOKING_INVITE_DECLINED]: {
    title: "Invite declined",
    body: "Your match declined the date invite.",
    screen: "MyBookingsScreen",
  },
  [NOTIFICATION_TYPES.BOOKING_INVITE_EXPIRED]: {
    title: "Invite expired",
    body: "Your date invite was not accepted in time.",
    screen: "MyBookingsScreen",
  },
  [NOTIFICATION_TYPES.BOOKING_CANCELLED]: {
    title: "Booking cancelled",
    body: "Your booking has been cancelled.",
    screen: "MyBookingsScreen",
  },
  [NOTIFICATION_TYPES.BOOKING_EXPIRING_SOON]: {
    title: "Upcoming booking",
    body: "You have a date booking coming up soon.",
    screen: "MyBookingsScreen",
  },

  // Explore — event tickets
  [NOTIFICATION_TYPES.TICKET_CONFIRMED]: {
    title: "Ticket confirmed",
    body: "Your ticket purchase is confirmed.",
    screen: "EventDetailScreen",
  },
  [NOTIFICATION_TYPES.EVENT_REMINDER]: {
    title: "Event tonight!",
    body: "Your event is coming up today.",
    screen: "EventDetailScreen",
  },
  [NOTIFICATION_TYPES.TICKET_FULFILLED]: {
    title: "Ticket ready",
    body: "Your ticket details are ready.",
    screen: "EventDetailScreen",
  },

  // Explore — premium
  [NOTIFICATION_TYPES.PREMIUM_QUOTE_READY]: {
    title: "Your quote is ready",
    body: "The Fuse team has prepared your premium experience quote.",
    screen: "PremiumRequestScreen",
  },
  [NOTIFICATION_TYPES.PREMIUM_CONFIRMED]: {
    title: "Premium experience confirmed",
    body: "Your premium experience is all set.",
    screen: "PremiumRequestScreen",
  },

  // Explore — admin
  [NOTIFICATION_TYPES.EXPLORE_ADMIN_NEW_BOOKING]: {
    title: "New date booking",
    body: "A new booking needs review.",
    screen: "MyBookingsScreen",
  },
  [NOTIFICATION_TYPES.EXPLORE_ADMIN_NEW_TICKET]: {
    title: "New ticket order",
    body: "A new ticket order needs review.",
    screen: "EventDetailScreen",
  },
  [NOTIFICATION_TYPES.EXPLORE_ADMIN_NEW_PREMIUM]: {
    title: "New premium request",
    body: "A premium request needs follow-up.",
    screen: "PremiumRequestScreen",
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
