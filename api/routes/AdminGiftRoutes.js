import express from "express";
import {
  getAdminGiftOrders,
  getAdminGiftOrderDetails,
  updateAdminGiftOrderStatus,
  updateAdminGiftOrderNotes,
} from "../controllers/AdminGiftController.js";

// authMiddleware + adminMiddleware are applied at mount time in server.js.
const router = express.Router();

router.get("/orders", getAdminGiftOrders);
router.get("/orders/:orderId", getAdminGiftOrderDetails);
router.patch("/orders/:orderId/status", updateAdminGiftOrderStatus);
router.patch("/orders/:orderId/notes", updateAdminGiftOrderNotes);

export default router;
