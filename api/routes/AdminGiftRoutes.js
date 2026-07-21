import express from "express";
import {
  getAdminGiftOrders,
  getAdminGiftOrderDetails,
  updateAdminGiftOrderStatus,
  updateAdminGiftOrderNotes,
  getPendingUpiPayments,
  verifyUpiPayment,
  rejectUpiPayment,
} from "../controllers/AdminGiftController.js";

// authMiddleware + adminMiddleware are applied at mount time in server.js.
const router = express.Router();

router.get("/orders", getAdminGiftOrders);
router.get("/orders/:orderId", getAdminGiftOrderDetails);
router.patch("/orders/:orderId/status", updateAdminGiftOrderStatus);
router.patch("/orders/:orderId/notes", updateAdminGiftOrderNotes);

router.get("/upi-pending", getPendingUpiPayments);
router.patch("/upi/:paymentId/verify", verifyUpiPayment);
router.patch("/upi/:paymentId/reject", rejectUpiPayment);

export default router;
