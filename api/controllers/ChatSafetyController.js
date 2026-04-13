import Chat from "../models/ChatModel.js";
import Block from "../models/Block.js";
import Report from "../models/Report.js";
import client from "../config/twilio.js";

const ACTIVE_CHAT_STATUSES = ["pending", "accepted"];

const normalizePairKey = (a, b) => {
  return [a.toString(), b.toString()].sort().join("|");
};

const ensureParticipant = (chat, userId) => {
  const senderId = chat.senderId?.toString?.() || "";
  const receiverId = chat.receiverId?.toString?.() || "";
  return senderId === userId.toString() || receiverId === userId.toString();
};

const resolveTargetUserId = ({ chat, actorUserId, explicitTargetUserId }) => {
  if (explicitTargetUserId) {
    return explicitTargetUserId.toString();
  }

  const senderId = chat?.senderId?.toString?.() || "";
  const receiverId = chat?.receiverId?.toString?.() || "";

  if (!chat) return "";
  return senderId === actorUserId.toString() ? receiverId : senderId;
};

const removeTwilioMembers = async (channelSid) => {
  if (!channelSid || !process.env.TWILIO_CHAT_SERVICE_SID) return;

  try {
    const service = client.chat.v2.services(process.env.TWILIO_CHAT_SERVICE_SID);
    const members = await service.channels(channelSid).members.list();
    await Promise.allSettled(
      members.map((member) => service.channels(channelSid).members(member.sid).remove())
    );
  } catch (error) {
    console.error("Failed to remove Twilio members for blocked chat:", error.message);
  }
};

export const blockChatUser = async (req, res) => {
  try {
    const blockerId = req.user.id;
    const { chatId, targetUserId } = req.body || {};

    let chat = null;
    if (chatId) {
      chat = await Chat.findById(chatId);
      if (!chat) {
        return res.status(404).json({ success: false, message: "Chat not found" });
      }
      if (!ensureParticipant(chat, blockerId)) {
        return res.status(403).json({ success: false, message: "Unauthorized for this chat" });
      }
    }

    const blockedId = resolveTargetUserId({
      chat,
      actorUserId: blockerId,
      explicitTargetUserId: targetUserId,
    });

    if (!blockedId || blockedId === blockerId.toString()) {
      return res.status(400).json({ success: false, message: "Invalid user to block" });
    }

    await Block.findOneAndUpdate(
      { blockerId, blockedId },
      {
        $set: {
          sourceChatId: chat?._id || null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const pairKey = normalizePairKey(blockerId, blockedId);
    const relatedChats = await Chat.find({
      pairKey,
      status: { $in: ACTIVE_CHAT_STATUSES },
    });

    for (const relatedChat of relatedChats) {
      relatedChat.status = "closed";
      await relatedChat.save();
      await removeTwilioMembers(
        relatedChat.twilioChannelSid || relatedChat.twilioChatChannelSid
      );
    }

    return res.status(200).json({
      success: true,
      blockedUserId: blockedId,
      message: "User blocked successfully",
    });
  } catch (error) {
    console.error("Error blocking user from chat:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to block user",
    });
  }
};

export const reportChatUser = async (req, res) => {
  try {
    const reporterId = req.user.id;
    const { chatId, targetUserId, reason, notes } = req.body || {};
    const trimmedReason = String(reason || "").trim();
    const trimmedNotes = String(notes || "").trim();

    if (!trimmedReason) {
      return res.status(400).json({ success: false, message: "Report reason is required" });
    }

    let chat = null;
    if (chatId) {
      chat = await Chat.findById(chatId);
      if (!chat) {
        return res.status(404).json({ success: false, message: "Chat not found" });
      }
      if (!ensureParticipant(chat, reporterId)) {
        return res.status(403).json({ success: false, message: "Unauthorized for this chat" });
      }
    }

    const reportedUserId = resolveTargetUserId({
      chat,
      actorUserId: reporterId,
      explicitTargetUserId: targetUserId,
    });

    if (!reportedUserId || reportedUserId === reporterId.toString()) {
      return res.status(400).json({ success: false, message: "Invalid user to report" });
    }

    const report = await Report.create({
      reporterId,
      reportedUserId,
      chatId: chat?._id || null,
      reason: trimmedReason,
      notes: trimmedNotes,
      status: "open",
    });

    return res.status(201).json({
      success: true,
      reportId: report._id.toString(),
      status: report.status,
      message: "Report submitted successfully",
    });
  } catch (error) {
    console.error("Error reporting user from chat:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit report",
    });
  }
};
