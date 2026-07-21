/**
 * exploreCommerceGuard — blocks Fuse Explore's committing/commerce actions
 * (bookings, ticket purchases, premium requests, event-circle RSVP lifecycle)
 * until each vertical's fulfilment/payment loop is production-ready.
 *
 * Browsing stays open — this guard is applied only to write routes, never reads.
 * It is the server-side safety net behind the app's "Coming soon" CTA gate, so
 * that no order or payment can be created even from a stale/modified client.
 *
 * Flip on for launch by setting EXPLORE_COMMERCE_LIVE=true in the backend env.
 */
const exploreCommerceGuard = (req, res, next) => {
  if (process.env.EXPLORE_COMMERCE_LIVE === "true") return next();
  return res.status(503).json({
    success: false,
    code: "EXPLORE_COMING_SOON",
    message: "This Explore feature is launching soon. Hang tight!",
  });
};

export default exploreCommerceGuard;
