import express from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import {
  registerToken,
  unregisterToken,
} from "../controllers/NotificationController.js";

const router = express.Router();

router.post("/register-token", authMiddleware, registerToken);
router.post("/unregister-token", authMiddleware, unregisterToken);

export default router;
