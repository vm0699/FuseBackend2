import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  sendCompliment,
  getUserChats,
  handleChatRequest,
  getTwilioToken,
  closeChat,
  getChatMessages,
  saveChatMessage,
  createGiftOrder,
  createGiftIntent,
  acceptGiftIntent,
  rejectGiftIntent,
  getGiftIntentDetails,
} from "../controllers/ChatController.js";
import {
  initiateGiftPayment,
  confirmGiftPayment,
} from "../controllers/GiftPaymentController.js";
import {
  getSentGifts,
  getReceivedGifts,
  updateGiftOrderStatus,
  getGiftOrderDetails,
} from "../controllers/GiftTrackingController.js";
import { blockChatUser, reportChatUser } from "../controllers/ChatSafetyController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

const sendComplimentRateLimit = createRateLimiter({
  keyPrefix: "chat-send-compliment",
  windowMs: 5 * 60 * 1000,
  max: 8,
  message: "Too many compliment requests. Please slow down.",
});

const handleRequestRateLimit = createRateLimiter({
  keyPrefix: "chat-handle-request",
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: "Too many chat request actions. Please try again shortly.",
});

const messageRateLimit = createRateLimiter({
  keyPrefix: "chat-message",
  windowMs: 60 * 1000,
  max: 40,
  message: "Too many messages too quickly. Please slow down.",
});

const blockRateLimit = createRateLimiter({
  keyPrefix: "chat-block",
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: "Too many block actions. Please try again later.",
});

const reportRateLimit = createRateLimiter({
  keyPrefix: "chat-report",
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: "Too many reports submitted. Please try again later.",
});

router.post("/send-compliment", authMiddleware, sendComplimentRateLimit, sendCompliment);
router.post("/handle-chat-request", authMiddleware, handleRequestRateLimit, handleChatRequest);
router.get("/list", authMiddleware, getUserChats);
router.get("/twilio-token", authMiddleware, getTwilioToken);
router.post("/block-user", authMiddleware, blockRateLimit, blockChatUser);
router.post("/report-user", authMiddleware, reportRateLimit, reportChatUser);
router.post("/close", authMiddleware, closeChat);
router.get("/:chatId/messages", authMiddleware, getChatMessages);
router.post("/:chatId/messages", authMiddleware, messageRateLimit, saveChatMessage);

router.post("/:chatId/gift", authMiddleware, createGiftOrder);
router.post("/:chatId/gift-intent", authMiddleware, createGiftIntent);
router.get("/gift-intent/:intentId", authMiddleware, getGiftIntentDetails);
router.post("/gift-intent/:intentId/accept", authMiddleware, acceptGiftIntent);
router.post("/gift-intent/:intentId/reject", authMiddleware, rejectGiftIntent);
router.post("/gift-intent/:intentId/pay", authMiddleware, initiateGiftPayment);
router.post("/gift-intent/:intentId/pay/confirm", authMiddleware, confirmGiftPayment);
router.get("/gifts/sent", authMiddleware, getSentGifts);
router.get("/gifts/received", authMiddleware, getReceivedGifts);
router.get("/gifts/order/:orderId", authMiddleware, getGiftOrderDetails);
router.patch("/gifts/order/:orderId/status", authMiddleware, updateGiftOrderStatus);

export default router;
