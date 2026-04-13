import express from 'express';
import { verifyPhoneNumber, verifyCode, refreshToken } from '../controllers/authController.js';
import { createRateLimiter } from "../middleware/rateLimit.js";

const router = express.Router();

const otpSendRateLimit = createRateLimiter({
  keyPrefix: "auth-send-otp",
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: "Too many OTP requests. Please wait a bit before trying again.",
});

const otpVerifyRateLimit = createRateLimiter({
  keyPrefix: "auth-verify-otp",
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: "Too many OTP verification attempts. Please wait and try again.",
});

router.post('/verifyPhoneNumber', otpSendRateLimit, verifyPhoneNumber);
router.post('/verifyCode', otpVerifyRateLimit, verifyCode);
router.post('/refresh-token', refreshToken);

export default router;
