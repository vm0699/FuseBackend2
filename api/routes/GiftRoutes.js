import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  getGiftCatalog,
  getGiftCatalogItem,
} from "../controllers/GiftCatalogController.js";
import { declineGiftOrder } from "../controllers/GiftTrackingController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

const declineRateLimit = createRateLimiter({
  keyPrefix: "gift-decline",
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: "Too many decline actions. Please try again later.",
});

// Catalog (read-only)
router.get("/catalog", authMiddleware, getGiftCatalog);
router.get("/catalog/:itemId", authMiddleware, getGiftCatalogItem);

// Recipient decline (pre-fulfilment)
router.post(
  "/orders/:orderId/decline",
  authMiddleware,
  declineRateLimit,
  declineGiftOrder
);

export default router;
