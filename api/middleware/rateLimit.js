const buckets = new Map();

const cleanupExpiredEntries = () => {
  const now = Date.now();
  for (const [key, value] of buckets.entries()) {
    if (value.resetAt <= now) {
      buckets.delete(key);
    }
  }
};

setInterval(cleanupExpiredEntries, 60 * 1000).unref();

export const createRateLimiter = ({
  keyPrefix,
  windowMs,
  max,
  message,
}) => {
  return (req, res, next) => {
    const identity =
      req.user?.id?.toString?.() ||
      req.ip ||
      req.headers["x-forwarded-for"] ||
      "anonymous";

    const key = `${keyPrefix}:${identity}`;
    const now = Date.now();
    const current = buckets.get(key);

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (current.count >= max) {
      const retryAfterSeconds = Math.ceil((current.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        message,
      });
    }

    current.count += 1;
    buckets.set(key, current);
    return next();
  };
};
