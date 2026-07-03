/**
 * Fire-and-forget analytics event logger.
 * Never throws — never blocks the calling request.
 *
 * Usage:
 *   logEvent("explore_listing_viewed", req.user._id, { listingId, category })
 *
 * Key events to instrument:
 *   explore_home_viewed | explore_category_viewed | explore_listing_viewed
 *   booking_started     | booking_invite_sent     | booking_payment_initiated
 *   booking_confirmed   | booking_cancelled
 *   ticket_started      | ticket_payment_initiated | ticket_confirmed
 *   gift_started        | gift_payment_initiated   | gift_confirmed
 *   premium_requested
 *   match_to_date_conversion (when an invited match accepts a booking)
 */
import AnalyticsEvent from "../../models/AnalyticsEvent.js";

export const logEvent = async (event, userId = null, properties = {}, platform = "server") => {
  try {
    await AnalyticsEvent.create({
      event,
      userId: userId || undefined,
      properties,
      city: properties.city || "Chennai",
      platform,
    });
  } catch {
    // Silent — analytics must never break product flows
  }
};

export default { logEvent };
