// api/routes/agoraRoutes.js
import { Router } from "express";
import authMiddleware from "../middleware/authMiddleware.js";
import AgoraTokenPkg from "agora-access-token";

const { RtmTokenBuilder, RtmRole, RtcTokenBuilder, RtcRole } = AgoraTokenPkg;

const router = Router();

/**
 * GET /api/agora/rtm-token
 * Generates Agora RTM token for chat
 */
router.get("/rtm-token", authMiddleware, async (req, res) => {
  try {
    const AGORA_APP_ID = process.env.AGORA_APP_ID;
    const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

    if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
      return res.status(500).json({ message: "Agora credentials missing" });
    }

    // Use userId as RTM identity (string)
    const userId = req.user.id;

    const expireTimeInSeconds = 3600;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpireTime = currentTimestamp + expireTimeInSeconds;

    const token = RtmTokenBuilder.buildToken(
      AGORA_APP_ID,
      AGORA_APP_CERTIFICATE,
      userId,
      RtmRole.Rtm_User,
      privilegeExpireTime
    );

    res.json({ token });
  } catch (err) {
    console.error("Agora RTM token error:", err);
    res.status(500).json({ message: "Failed to generate RTM token" });
  }
});

router.get("/token", authMiddleware, async (req, res) => {
  try {
    const AGORA_APP_ID = process.env.AGORA_APP_ID;
    const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;

    if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
      return res.status(500).json({ message: "Agora credentials missing" });
    }

    const { channelName, uid } = req.query;
    if (!channelName || !uid) {
      return res.status(400).json({ message: "channelName and uid are required" });
    }

    const parsedUid = Number(uid);
    if (!Number.isInteger(parsedUid) || parsedUid <= 0) {
      return res.status(400).json({ message: "uid must be a positive integer" });
    }

    const expireTimeInSeconds = 3600;
    const privilegeExpireTime = Math.floor(Date.now() / 1000) + expireTimeInSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_APP_ID,
      AGORA_APP_CERTIFICATE,
      String(channelName),
      parsedUid,
      RtcRole.PUBLISHER,
      privilegeExpireTime
    );

    return res.json({
      token,
      uid: parsedUid,
      channelName: String(channelName),
      appId: AGORA_APP_ID,
    });
  } catch (err) {
    console.error("Agora RTC token error:", err);
    return res.status(500).json({ message: "Failed to generate RTC token" });
  }
});

export default router;
