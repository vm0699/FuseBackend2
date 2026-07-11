/**
 * Discovery deck cache — swipe/Explore discovery result caching.
 *
 * Extracted from ProfileController.js so it's a single, swappable seam.
 * Current implementation: in-memory Map, 15-min TTL, per-process.
 *
 * PRODUCTION CONSTRAINT: this cache is per-Node-process. It is correct and
 * safe as long as the backend runs as a SINGLE instance (no PM2 cluster mode,
 * no horizontal autoscaling group). With more than one instance, different
 * users can land on different processes and see inconsistent/stale decks
 * across requests — not a crash, just a correctness gap.
 *
 * NEXT PHASE (Redis): swap only the three function bodies below for
 * ioredis/node-redis calls (e.g. `redis.get/set` with `EX` for TTL,
 * JSON.stringify/parse the deck). Every caller (ProfileController.js) goes
 * through this module's exported functions, so the swap touches this file
 * only — no changes needed anywhere discovery is used.
 */

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const discoveryDeckCache = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of discoveryDeckCache.entries()) {
    if (now > entry.expiresAt) discoveryDeckCache.delete(key);
  }
}, CACHE_CLEANUP_INTERVAL_MS).unref();

function getCachedDeck(userId, filtersKey) {
  const entry = discoveryDeckCache.get(userId);
  if (!entry || Date.now() > entry.expiresAt || entry.filtersKey !== filtersKey) {
    discoveryDeckCache.delete(userId);
    return null;
  }
  return entry.deck;
}

function setCachedDeck(userId, deck, filtersKey) {
  discoveryDeckCache.set(userId, {
    deck,
    filtersKey,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function clearCachedDeck(userId) {
  discoveryDeckCache.delete(userId);
}

export { getCachedDeck, setCachedDeck, clearCachedDeck };
export default { getCachedDeck, setCachedDeck, clearCachedDeck };
