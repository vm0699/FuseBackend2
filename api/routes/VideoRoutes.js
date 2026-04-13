import express from "express";
import { generateVideoToken } from "../controllers/VideoController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// Route to generate Twilio token for the video call
router.post("/token", authMiddleware, generateVideoToken);

// Placeholder for matchmaking logic, but actual matchmaking happens in the WebSocket server
router.post("/match", authMiddleware, (req, res) => {
  // This is just a placeholder, matchmaking will be handled via WebSocket
  res.status(200).json({ success: true, message: "Matchmaking process initiated" });
});

export default router;
