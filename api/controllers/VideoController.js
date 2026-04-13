import twilio from "twilio";
import notificationService from "../services/notificationService.js";

const AccessToken = twilio.jwt.AccessToken;
const VideoGrant = AccessToken.VideoGrant;

export const generateVideoToken = async (req, res) => {
  try {
    const { room } = req.body;
    const userId = req.user?.id;

    if (!userId || !room) {
      return res
        .status(400)
        .json({ success: false, message: "Missing identity or room" });
    }

    if (
      !process.env.TWILIO_ACCOUNT_SID ||
      !process.env.TWILIO_API_KEY_SID ||
      !process.env.TWILIO_API_KEY_SECRET
    ) {
      return res
        .status(500)
        .json({ success: false, message: "Twilio credentials missing" });
    }

    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY_SID,
      process.env.TWILIO_API_KEY_SECRET,
      {
        ttl: 3600,
        identity: userId.toString(),
      }
    );

    token.addGrant(new VideoGrant({ room: String(room).trim() }));

    return res.status(200).json({
      success: true,
      token: token.toJwt(),
      room: String(room).trim(),
      identity: userId.toString(),
    });
  } catch (error) {
    console.error("Error generating Twilio video token:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to generate Twilio token",
    });
  }
};

// Integration point for future direct-call flows.
// Invoke this when a user explicitly invites another user into a call room.
export const sendVideoCallInviteNotification = async ({
  recipientUserId,
  callerUserId,
  room,
  channelName,
}) => {
  if (!recipientUserId) return;

  await notificationService.sendVideoCallInvite(recipientUserId, {
    type: "VIDEO_CALL_INVITE",
    callerUserId: callerUserId ? String(callerUserId) : null,
    room: room || null,
    channelName: channelName || room || null,
    screen: "VideoInitiateScreen",
  });
};

// Integration point for future direct-call flows.
// Invoke this when an invite expires or a callee never answers.
export const sendMissedVideoCallNotification = async ({
  recipientUserId,
  callerUserId,
  room,
  channelName,
}) => {
  if (!recipientUserId) return;

  await notificationService.sendMissedVideoCall(recipientUserId, {
    type: "VIDEO_CALL_MISSED",
    callerUserId: callerUserId ? String(callerUserId) : null,
    room: room || null,
    channelName: channelName || room || null,
    screen: "VideoInitiateScreen",
  });
};
