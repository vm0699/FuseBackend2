import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  getGiftCatalog,
  getGiftCatalogItem,
} from "../controllers/GiftCatalogController.js";
import { declineGiftOrder } from "../controllers/GiftTrackingController.js";
import { handleGiftRazorpayWebhook } from "../controllers/GiftPaymentController.js";
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

// Razorpay webhook — server-to-server, no user auth (verified by signature
// instead). The raw body needed for signature verification is set up in
// server.js (express.raw() mounted on this exact path before the global
// express.json() parser), so req.body here is already a Buffer.
router.post("/razorpay/webhook", handleGiftRazorpayWebhook);

export default router;
