import Chat from "../models/ChatModel.js";
import UserProfile from "../models/UserProfile.js";
import GiftOrder from "../models/GiftOrder.js";
import GiftIntent from "../models/GiftIntentModel.js";
import Block from "../models/Block.js";
import client from "../config/twilio.js";
import dotenv from "dotenv";
import twilio from "twilio";
import notificationService from "../services/notificationService.js";
import { NOTIFICATION_TYPES } from "../services/notifications/notificationTypes.js";

dotenv.config();

const normalizePairKey = (a, b) => {
  return [a.toString(), b.toString()].sort().join("|");
};

const findBlockBetweenUsers = async (userAId, userBId) => {
  if (!userAId || !userBId) return null;
  return Block.findOne({
    $or: [
      { blockerId: userAId, blockedId: userBId },
      { blockerId: userBId, blockedId: userAId },
    ],
  }).lean();
};

const getBlockedCounterpartIds = async (userId) => {
  const blocks = await Block.find({
    $or: [{ blockerId: userId }, { blockedId: userId }],
  }).lean();

  return new Set(
    blocks.map((block) =>
      block.blockerId?.toString() === userId.toString()
        ? block.blockedId?.toString()
        : block.blockerId?.toString()
    )
  );
};

// 🎁 GIFT TIERS
const determineGiftTier = (amount) => {
  if (amount <= 499) return "LOW";
  if (amount <= 2999) return "MID";
  return "HIGH";
};

const buildGiftRules = (tier) => {
  if (tier === "LOW") {
    return {
      requiresRecipientConsent: false,
      requiresRecipientPayment: false,
    };
  }

  if (tier === "MID") {
    return {
      requiresRecipientConsent: true,
      requiresRecipientPayment: true,
    };
  }

  return {
    requiresRecipientConsent: true,
    requiresRecipientPayment: true,
    experienceOnly: true,
  };
};

const getDisplayName = (user) =>
  user?.name || user?.username || "Someone";

const getTwilioChannelSid = (chat) =>
  chat?.twilioChannelSid || chat?.twilioChatChannelSid || null;

const buildChatNotificationData = ({
  chat,
  senderId,
  recipientId,
  counterpartId,
  counterpartName,
  messageId,
}) => ({
  chatId: chat?._id?.toString?.() || chat?._id || null,
  senderId: senderId ? String(senderId) : null,
  recipientId: recipientId ? String(recipientId) : null,
  counterpartId: counterpartId ? String(counterpartId) : null,
  messageId: messageId ? String(messageId) : null,
  chatStatus: chat?.status || null,
  screen: "ChatScreen",
  extra: {
    counterpartName: counterpartName || "",
    twilioChannelSid: getTwilioChannelSid(chat),
  },
});

const mapGiftIntentForResponse = async (intent, currentUserId) => {
  const populatedIntent = await GiftIntent.findById(intent._id)
    .populate("senderId", "name username photos")
    .populate("recipientId", "name username photos")
    .lean();

  if (!populatedIntent) return null;

  const isSender =
    populatedIntent.senderId?._id?.toString?.() === currentUserId?.toString?.();
  const counterpart = isSender
    ? populatedIntent.recipientId
    : populatedIntent.senderId;

  return {
    intentId: populatedIntent._id,
    chatId: populatedIntent.chatId,
    tier: populatedIntent.tier,
    status: populatedIntent.status,
    totalAmount: populatedIntent.totalAmount,
    items: populatedIntent.items || [],
    senderId: populatedIntent.senderId?._id || populatedIntent.senderId,
    recipientId: populatedIntent.recipientId?._id || populatedIntent.recipientId,
    createdAt: populatedIntent.createdAt,
    updatedAt: populatedIntent.updatedAt,
    counterpart: {
      id: counterpart?._id || null,
      name: counterpart?.name || "",
      username: counterpart?.username || "",
      photo:
        Array.isArray(counterpart?.photos) && counterpart.photos.length > 0
          ? counterpart.photos[0]
          : null,
    },
  };
};


const ensureTwilioChannel = async (chat, userA, userB) => {
  const channelSid = chat.twilioChannelSid || chat.twilioChatChannelSid;

  const service = client.chat.v2.services(process.env.TWILIO_CHAT_SERVICE_SID);
  let channel = null;

  if (channelSid) {
    try {
      channel = await service.channels(channelSid).fetch();
    } catch (err) {
      // If fetch fails, we'll recreate below
      channel = null;
    }
  }

  if (!channel) {
    const friendlyName = `${userA}-${userB}`;
    const uniqueName = `chat-${normalizePairKey(userA, userB)}`;
    const created = await service.channels.create({ friendlyName, uniqueName });
    channel = await service.channels(created.sid).fetch();

    chat.twilioChannelSid = created.sid;
    chat.twilioChatChannelSid = chat.twilioChatChannelSid || created.sid;
    await chat.save();
  }

  // Ensure both participants are members
  const members = await service.channels(chat.twilioChannelSid || chat.twilioChatChannelSid).members.list();
  const memberIds = members.map((m) => m.identity);
  const idsToAdd = [];
  if (!memberIds.includes(userA.toString())) idsToAdd.push(userA);
  if (!memberIds.includes(userB.toString())) idsToAdd.push(userB);

  for (const id of idsToAdd) {
    await service.channels(chat.twilioChannelSid || chat.twilioChatChannelSid).members.create({ identity: id.toString() });
  }

  return chat.twilioChannelSid || chat.twilioChatChannelSid;
};

const ensureParticipantIds = (chat, userAId, userBId) => {
  const existing = Array.isArray(chat.participants) ? chat.participants : [];
  const merged = [...existing];
  for (const id of [userAId, userBId]) {
    const idStr = id?.toString?.();
    if (!idStr) continue;
    const exists = merged.some((participant) => participant?.toString?.() === idStr);
    if (!exists) {
      merged.push(id);
    }
  }
  chat.participants = merged;
};

const appendComplimentMessage = async ({ chat, senderId, compliment }) => {
  const trimmed = (compliment || "").trim();
  if (!trimmed) return null;

  const now = Date.now();
  const recentDuplicate = (chat.messages || [])
    .slice(-5)
    .find(
      (m) =>
        m.sender?.toString() === senderId.toString() &&
        m.message === trimmed &&
        Math.abs(now - new Date(m.timestamp).getTime()) < 5 * 60 * 1000
    );

  if (!recentDuplicate) {
    chat.messages.push({ sender: senderId, message: trimmed, timestamp: new Date() });
    if (chat.twilioChannelSid || chat.twilioChatChannelSid) {
      await client.chat
        .services(process.env.TWILIO_CHAT_SERVICE_SID)
        .channels(chat.twilioChannelSid || chat.twilioChatChannelSid)
        .messages.create({ from: senderId.toString(), body: trimmed });
    }
    return trimmed;
  }

  return recentDuplicate.message;
};




/** Send Compliment & Initiate/Reuse Chat (idempotent, pair-based) */
export const sendCompliment = async (req, res) => {
  try {
    const { swipedUserId, compliment } = req.body;
    const senderId = req.user.id;
    const trimmedCompliment = (compliment || "").trim();

    console.log("🟣 [PHASE 1] sendCompliment called", {
      senderId,
      swipedUserId,
      trimmedCompliment,
    });

    if (!swipedUserId) {
      return res.status(400).json({ success: false, message: "Missing recipient ID" });
    }

    if (!trimmedCompliment) {
      return res.status(400).json({ success: false, message: "Compliment cannot be empty" });
    }

    const existingBlock = await findBlockBetweenUsers(senderId, swipedUserId);
    if (existingBlock) {
      return res.status(403).json({
        success: false,
        message: "You can no longer interact with this user",
      });
    }

    const pairKey = normalizePairKey(senderId, swipedUserId);
    console.log("🟣 [PHASE 1] Computed pairKey:", pairKey);

    // ✅ REUSE ONLY IF ACTIVE
    let chat = await Chat.findOne({
      pairKey,
      status: { $in: ["pending", "accepted"] },
    });

    if (chat) {
      console.log("🟣 [PHASE 1] Reusing ACTIVE chat:", chat._id.toString());
    }

    // ❌ DO NOT reuse rejected/closed chats
    if (!chat) {
      console.log("🟣 [PHASE 1] No active chat found, creating NEW chat");
      chat = new Chat({
        senderId,
        receiverId: swipedUserId,
        pairKey,
        status: "pending",
        messages: [],
        participants: [senderId, swipedUserId],
      });
    }

    chat.pairKey = pairKey;
    ensureParticipantIds(chat, senderId, swipedUserId);

    const channelSid = await ensureTwilioChannel(chat, senderId, swipedUserId);

    const complimentPreview = await appendComplimentMessage({
      chat,
      senderId,
      compliment: trimmedCompliment,
    });

    await chat.save();

    await notificationService.sendToUser(
      swipedUserId,
      notificationService.buildNotificationPayload({
        type: NOTIFICATION_TYPES.COMPLIMENT_RECEIVED,
        title: "New compliment",
        body: `${getDisplayName(req.user)} sent you a compliment.`,
        data: buildChatNotificationData({
          chat,
          senderId,
          recipientId: swipedUserId,
          counterpartId: senderId,
          counterpartName: getDisplayName(req.user),
        }),
      })
    );

    console.log("🟣 [PHASE 1] Chat saved", {
      chatId: chat._id.toString(),
      status: chat.status,
      channelSid,
    });

    return res.status(200).json({
      success: true,
      chatId: chat._id,
      status: chat.status,
      twilioChannelSid: channelSid,
      complimentPreview,
      senderId,
      recipientId: swipedUserId,
      showMatchedBanner: false,
    });
  } catch (error) {
    console.error("🔴 [PHASE 1] Error sending compliment:", error);
    return res.status(500).json({ success: false, message: "Failed to send compliment" });
  }
};


/** Fetch User Chats (pending + accepted) */
export const getUserChats = async (req, res) => {
  try {
    const userId = req.user.id;
    const blockedCounterpartIds = await getBlockedCounterpartIds(userId);

    const chats = await Chat.find({
      $or: [{ senderId: userId }, { receiverId: userId }],
      status: { $in: ["accepted", "pending"] },
    }).populate("receiverId senderId");

    const formatted = (chats || [])
      .map((chat) => {
        const isCurrentUserSender = chat.senderId?._id?.toString() === userId;
        const otherUser = isCurrentUserSender ? chat.receiverId : chat.senderId;
        if (!otherUser) return null;
        if (blockedCounterpartIds.has(otherUser._id?.toString?.() || otherUser._id?.toString())) {
          return null;
        }

        const lastMsg = chat.messages?.length ? chat.messages[chat.messages.length - 1] : null;

        return {
          _id: chat._id,
          twilioChatChannelSid: chat.twilioChannelSid || chat.twilioChatChannelSid,
          twilioChannelSid: chat.twilioChannelSid || chat.twilioChatChannelSid,
          user: {
            id: otherUser._id?.toString?.() || otherUser._id,
            name: otherUser.name || "Unknown User",
            username: otherUser.username || "",
            photos: Array.isArray(otherUser.photos) ? otherUser.photos : [],
          },
          lastMessage: lastMsg,
          complimentPreview: lastMsg ? lastMsg.message : null,
          status: chat.status,
          isPending: chat.status === "pending",
          actualReceiverId: chat.receiverId?._id?.toString(),
          showMatchedBanner: false,
        };
      })
      .filter(Boolean);

    return res.status(200).json({ success: true, chats: formatted });
  } catch (error) {
    console.error("Error fetching chats:", error);
    return res.status(500).json({ success: false, message: "Failed to retrieve chats" });
  }
};

/** Handle Chat Request Accept/Reject (idempotent) */
export const handleChatRequest = async (req, res) => {
  try {
    const { chatId, action } = req.body;
    const userId = req.user.id;

    console.log("🟣 [PHASE 1] handleChatRequest called", {
      chatId,
      action,
      userId,
    });

    const chat = await Chat.findById(chatId).populate("senderId receiverId");
    if (!chat) {
      return res.status(404).json({ success: false, message: "Chat not found" });
    }

    // 🔹 Phase-1 safety: do not allow actions on closed chats
    if (chat.status === "closed") {
      console.log("🟣 [PHASE 1] Action attempted on CLOSED chat", chatId);
      return res.status(400).json({
        success: false,
        message: "Chat is closed",
      });
    }

    const senderIdStr = chat.senderId?._id?.toString() || chat.senderId?.toString();
    const receiverIdStr = chat.receiverId?._id?.toString() || chat.receiverId?.toString();

    const existingBlock = await findBlockBetweenUsers(senderIdStr, receiverIdStr);
    if (existingBlock) {
      return res.status(403).json({
        success: false,
        message: "This chat is no longer available",
      });
    }

    const otherUser =
      senderIdStr === userId?.toString() ? chat.receiverId : chat.senderId;

    const complimentPreview =
      chat.messages && chat.messages.length
        ? chat.messages[chat.messages.length - 1].message
        : null;

    chat.pairKey =
      chat.pairKey || normalizePairKey(senderIdStr, receiverIdStr);

    const participantIds = [senderIdStr, receiverIdStr].filter(Boolean);
    if (!participantIds.includes(userId.toString())) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to modify this chat request",
      });
    }

    if (action === "accept") {
      const alreadyAccepted = chat.status === "accepted";

      if (!alreadyAccepted) {
        chat.status = "accepted";
        ensureParticipantIds(
          chat,
          chat.senderId?._id || chat.senderId,
          chat.receiverId?._id || chat.receiverId
        );
        await ensureTwilioChannel(
          chat,
          chat.senderId?._id || chat.senderId,
          chat.receiverId?._id || chat.receiverId
        );
        await chat.save();
      }

      if (senderIdStr && senderIdStr !== userId.toString()) {
        await notificationService.sendToUser(
          senderIdStr,
          notificationService.buildNotificationPayload({
            type: NOTIFICATION_TYPES.COMPLIMENT_ACCEPTED,
            title: "Compliment accepted",
            body: `${getDisplayName(chat.receiverId)} accepted your compliment.`,
            data: buildChatNotificationData({
              chat,
              senderId: receiverIdStr,
              recipientId: senderIdStr,
              counterpartId: receiverIdStr,
              counterpartName: getDisplayName(chat.receiverId),
            }),
          })
        );
      }

      console.log("🟣 [PHASE 1] Chat accepted", {
        chatId: chat._id.toString(),
        alreadyAccepted,
      });

      return res.status(200).json({
        success: true,
        chatId: chat._id,
        status: "accepted",
        twilioChannelSid: chat.twilioChannelSid || chat.twilioChatChannelSid,
        showMatchedBanner: !alreadyAccepted,
        complimentPreview: complimentPreview || null,
        otherUser: otherUser
          ? {
              _id: otherUser._id,
              name: otherUser.name,
              photos: otherUser.photos,
            }
          : null,
      });
    }

    if (action === "reject") {
      const alreadyRejected = ["rejected", "closed"].includes(chat.status);

      if (!alreadyRejected) {
        chat.status = "rejected";
        await chat.save();
      }

      if (senderIdStr && senderIdStr !== userId.toString()) {
        await notificationService.sendToUser(
          senderIdStr,
          notificationService.buildNotificationPayload({
            type: NOTIFICATION_TYPES.COMPLIMENT_REJECTED,
            title: "Compliment declined",
            body: `${getDisplayName(chat.receiverId)} declined your compliment request.`,
            data: buildChatNotificationData({
              chat,
              senderId: receiverIdStr,
              recipientId: senderIdStr,
              counterpartId: receiverIdStr,
              counterpartName: getDisplayName(chat.receiverId),
            }),
          })
        );
      }

      console.log("🟣 [PHASE 1] Chat rejected", {
        chatId: chat._id.toString(),
      });

      return res.status(200).json({
        success: true,
        chatId: chat._id,
        status: "rejected",
        complimentPreview: null,
        otherUser: null,
      });
    }

    return res.status(400).json({
      success: false,
      message: "Invalid action",
    });
  } catch (error) {
    console.error("🔴 [PHASE 1] Error handling chat request:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to process chat request",
    });
  }
};



export const getTwilioToken = async (req, res) => {
  try {
    const { id: userId } = req.user;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized - Missing user info" });
    }

    const AccessToken = twilio.jwt.AccessToken;
    const ChatGrant = AccessToken.ChatGrant;

    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY_SID,
      process.env.TWILIO_API_KEY_SECRET,
      { identity: userId.toString() }
    );

    token.addGrant(
      new ChatGrant({
        serviceSid: process.env.TWILIO_CHAT_SERVICE_SID,
      })
    );

    res.status(200).json({ token: token.toJwt(), identity: userId.toString() });
  } catch (error) {
    console.error("Error generating Twilio token:", error);
    res.status(500).json({ success: false, message: "Failed to generate token" });
  }
};



/** Close / Unmatch an Accepted Chat */
/** Close / Unmatch an accepted chat (Phase 1) */
/** Close / Unmatch an accepted chat (Phase 1) */
export const closeChat = async (req, res) => {
  try {
    const { chatId } = req.body;
    const userId = req.user.id;

    console.log("🟣 [PHASE 1] closeChat called", {
      chatId,
      userId,
    });

    if (!chatId) {
      return res.status(400).json({
        success: false,
        message: "Missing chatId",
      });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "Chat not found",
      });
    }

    const senderIdStr = chat.senderId?.toString();
    const receiverIdStr = chat.receiverId?.toString();

    const existingBlock = await findBlockBetweenUsers(senderIdStr, receiverIdStr);
    if (existingBlock) {
      return res.status(403).json({
        success: false,
        message: "This chat is no longer available",
      });
    }
    const participantIds = [senderIdStr, receiverIdStr].filter(Boolean);

    if (!participantIds.includes(userId.toString())) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to close this chat",
      });
    }

    // Only accepted chats can be closed
    if (chat.status !== "accepted") {
      console.log("🟣 [PHASE 1] closeChat ignored — invalid state", {
        chatId,
        status: chat.status,
      });

      return res.status(400).json({
        success: false,
        message: "Only accepted chats can be closed",
      });
    }

    // 🔹 ADDITION: delete message history
    const deletedMessageCount = chat.messages?.length || 0;
    chat.messages = [];

    chat.status = "closed";
    await chat.save();

    console.log("🟣 [PHASE 1] Chat closed and history cleared", {
      chatId: chat._id.toString(),
      pairKey: chat.pairKey,
      deletedMessageCount,
    });

    return res.status(200).json({
      success: true,
      chatId: chat._id,
      status: "closed",
    });
  } catch (error) {
    console.error("🔴 [PHASE 1] Error closing chat:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to close chat",
    });
  }
};



/** Get chat message history from DB (Phase 2)
 *  - MongoDB is the source of truth
 *  - Returns messages normalized for UI
 *  - Does NOT depend on Twilio
 */
export const getChatMessages = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;

    console.log("🟣 [PHASE 2] getChatMessages called", {
      chatId,
      userId,
    });

    if (!chatId) {
      return res.status(400).json({
        success: false,
        message: "Missing chatId",
      });
    }

    const chat = await Chat.findById(chatId).lean();
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "Chat not found",
      });
    }

    const senderIdStr = chat.senderId?.toString();
    const receiverIdStr = chat.receiverId?.toString();

    const existingBlock = await findBlockBetweenUsers(senderIdStr, receiverIdStr);
    if (existingBlock) {
      return res.status(403).json({
        success: false,
        message: "This chat is no longer available",
      });
    }
    const participantIds = [senderIdStr, receiverIdStr].filter(Boolean);

    if (!participantIds.includes(userId.toString())) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to view this chat",
      });
    }

    // Normalize messages for frontend UI
    const messages = (chat.messages || [])
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .map((m, index) => ({
        id: `${chat._id.toString()}_${index}`,
        authorId: m.sender?.toString() || null,
        body: m.message,
        timestamp: m.timestamp,
      }));

    console.log("🟣 [PHASE 2] Messages fetched from DB", {
      chatId: chat._id.toString(),
      messageCount: messages.length,
    });

    return res.status(200).json({
      success: true,
      chatId: chat._id,
      messages,
    });
  } catch (error) {
    console.error("🔴 [PHASE 2] Error fetching chat messages:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch chat messages",
    });
  }
};



/** Save a realtime chat message to DB (Phase 3)
 *  - Called by sender device after realtime send succeeds
 *  - Dedupe protection (same sender + same text within 30s)
 *  - MongoDB remains source of truth
 */
export const saveChatMessage = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;
    const { message } = req.body;

    const trimmed = (message || "").trim();

    console.log("🟣 [PHASE 3] saveChatMessage called", {
      chatId,
      userId,
      trimmed,
    });

    if (!chatId) {
      return res.status(400).json({ success: false, message: "Missing chatId" });
    }

    if (!trimmed) {
      return res.status(400).json({ success: false, message: "Message cannot be empty" });
    }

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ success: false, message: "Chat not found" });
    }

    const senderIdStr = chat.senderId?.toString();
    const receiverIdStr = chat.receiverId?.toString();

    const existingBlock = await findBlockBetweenUsers(senderIdStr, receiverIdStr);
    if (existingBlock) {
      return res.status(403).json({
        success: false,
        message: "You can no longer send messages in this chat",
      });
    }
    const participantIds = [senderIdStr, receiverIdStr].filter(Boolean);

    if (!participantIds.includes(userId.toString())) {
      return res.status(403).json({ success: false, message: "Unauthorized to write to this chat" });
    }

    if (chat.status !== "accepted") {
      console.log("🟣 [PHASE 3] saveChatMessage blocked — chat not accepted", {
        chatId,
        status: chat.status,
      });
      return res.status(400).json({ success: false, message: "Chat not accepted" });
    }

    // 🔒 Dedupe: same sender + same message within last 30 seconds
    const now = Date.now();
    const recent = (chat.messages || []).slice(-10).find((m) => {
      const sameSender = m.sender?.toString() === userId.toString();
      const sameText = m.message === trimmed;
      const t = m.timestamp ? new Date(m.timestamp).getTime() : 0;
      return sameSender && sameText && Math.abs(now - t) < 30 * 1000;
    });

    if (recent) {
      console.log("🟣 [PHASE 3] Duplicate prevented", {
        chatId,
        message: trimmed,
      });
      return res.status(200).json({ success: true, duplicated: true });
    }

    chat.messages.push({
      sender: userId,
      message: trimmed,
      timestamp: new Date(),
    });

    await chat.save();

    console.log("🟣 [PHASE 3] Message saved to DB", {
      chatId: chat._id.toString(),
      totalMessages: chat.messages.length,
    });

    const lastMessage = chat.messages?.[chat.messages.length - 1];
    const recipientId =
      senderIdStr === userId.toString() ? receiverIdStr : senderIdStr;

    if (recipientId && recipientId !== userId.toString()) {
      console.log("[notifications] chat message trigger", {
        chatId: chat._id.toString(),
        senderId: String(userId),
        recipientId: String(recipientId),
        messageId: lastMessage?._id?.toString?.() || lastMessage?._id || null,
      });

      const notificationResult = await notificationService.sendToUser(
        recipientId,
        notificationService.buildNotificationPayload({
          type: NOTIFICATION_TYPES.CHAT_MESSAGE,
          title: "New message",
          body: `${getDisplayName(req.user)} sent you a message.`,
          data: buildChatNotificationData({
            chat,
            senderId: userId,
            recipientId,
            counterpartId: userId,
            counterpartName: getDisplayName(req.user),
            messageId: lastMessage?._id,
          }),
        })
      );

      console.log("[notifications] chat message send result", {
        chatId: chat._id.toString(),
        recipientId: String(recipientId),
        sentCount: notificationResult?.sentCount || 0,
        invalidated: notificationResult?.invalidated || 0,
      });
    } else {
      console.log("[notifications] chat message notification skipped", {
        chatId: chat._id.toString(),
        senderId: String(userId),
        recipientId: recipientId ? String(recipientId) : null,
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("🔴 [PHASE 3] Error saving chat message:", error);
    return res.status(500).json({ success: false, message: "Failed to save message" });
  }
};


export const createGiftIntent = async (req, res) => {
  try {
    const { chatId } = req.params;
    const senderId = req.user.id;
    const { items } = req.body;

    if (!chatId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid payload" });
    }

    const chat = await Chat.findById(chatId);
    if (!chat || chat.status !== "accepted") {
      return res.status(400).json({
        success: false,
        message: "Chat not accepted",
      });
    }

    // 🔒 Interaction threshold (both must have chatted)
    const uniqueSenders = new Set(chat.messages.map((m) => m.sender?.toString()));
    if (uniqueSenders.size < 2) {
      return res.status(400).json({
        success: false,
        message: "Minimum interaction not met",
      });
    }

    const senderIdStr = chat.senderId.toString();
    const recipientId =
      senderId.toString() === senderIdStr ? chat.receiverId : chat.senderId;

    // 💰 Calculate total
    const totalAmount = items.reduce(
      (sum, item) =>
        sum + Number(item.price || 0) * Number(item.quantity || 1),
      0
    );

    const tier = determineGiftTier(totalAmount);
    // (we still *can* call buildGiftRules if you use it elsewhere)
    const rules = buildGiftRules(tier);

    // 🔒 LOW TIER DAILY LIMIT (1 per chat per day)
    if (tier === "LOW") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const count = await GiftIntent.countDocuments({
        chatId,
        tier: "LOW",
        createdAt: { $gte: today },
      });

      if (count >= 1) {
        return res.status(400).json({
          success: false,
          message: "Low-cost gift limit reached for today",
        });
      }
    }

    const giftIntent = await GiftIntent.create({
      chatId,
      senderId,
      recipientId,
      tier,
      items,
      totalAmount,
      // 🔹 LOW → no consent, MID/HIGH → wait for recipient consent
      status: tier === "LOW" ? "CREATED" : "AWAITING_RECIPIENT",
      rulesSnapshot: {
        lowLimit: 499,
        midLimit: 2999,
        // 🔹 In single-payer model:
        //    – consent required only for MID/HIGH
        //    – recipient never pays
        requiresRecipientConsent: tier !== "LOW",
        requiresRecipientPayment: false,
      },
      expiresAt:
        tier === "LOW"
          ? null
          : new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await notificationService.sendToUser(
      recipientId,
      notificationService.buildNotificationPayload({
        type: NOTIFICATION_TYPES.GIFT_INTENT_RECEIVED,
        title: "Gift request received",
        body: `${getDisplayName(req.user)} sent you a gift intent.`,
        data: {
          intentId: giftIntent._id.toString(),
          chatId: String(chatId),
          senderId: String(senderId),
          recipientId: String(recipientId),
          screen: "GiftIntentDetailsScreen",
          extra: {
            counterpartName: getDisplayName(req.user),
            tier,
          },
        },
      })
    );

    return res.status(201).json({
      success: true,
      giftIntentId: giftIntent._id,
      tier,
      nextAction:
        tier === "LOW"
          ? "PROCEED_TO_PAYMENT"
          : "WAIT_FOR_RECIPIENT",
    });
  } catch (err) {
    console.error("🔥 createGiftIntent error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to create gift intent",
    });
  }
};


export const acceptGiftIntent = async (req, res) => {
  console.log("🔔 [DEBUG] acceptGiftIntent route hit");

  try {
    const { intentId } = req.params;
    const userId = req.user.id;
    console.log("🔔 [DEBUG] intentId:", intentId);
    console.log("🔔 [DEBUG] userId:", userId);

    const intent = await GiftIntent.findById(intentId);
    if (!intent) {
      return res
        .status(404)
        .json({ success: false, message: "Gift intent not found" });
    }

    console.log("🔔 [DEBUG] GiftIntent found", intent);

    // 🔒 Tier check – LOW never needs acceptance
    if (intent.tier === "LOW") {
      console.log("❌ [GIFT] Low-cost gifts do not require acceptance", {
        intentId,
      });
      return res.status(400).json({
        success: false,
        message: "Low-cost gifts do not require acceptance",
      });
    }

    // 🔒 Only recipient can accept
    if (intent.recipientId.toString() !== userId.toString()) {
      console.log("❌ [GIFT] Only recipient can accept this gift", {
        intentId,
        recipientId: intent.recipientId,
        userId,
      });
      return res.status(403).json({
        success: false,
        message: "Only recipient can accept this gift",
      });
    }

    // 🔒 State check – must be waiting for recipient
    if (intent.status !== "AWAITING_RECIPIENT") {
      console.log("❌ [GIFT] Gift intent is not awaiting acceptance", {
        intentId,
        status: intent.status,
      });
      return res.status(400).json({
        success: false,
        message: "Gift intent is not awaiting acceptance",
      });
    }

    // ✅ Accept → now sender can pay (single payer)
    intent.status = "ACCEPTED";
    await intent.save();

    await notificationService.sendToUser(
      intent.senderId,
      notificationService.buildNotificationPayload({
        type: NOTIFICATION_TYPES.GIFT_INTENT_ACCEPTED,
        title: "Gift accepted",
        body: "Your gift intent was accepted.",
        data: {
          intentId: intent._id.toString(),
          chatId: intent.chatId?.toString?.() || intent.chatId,
          senderId: intent.senderId?.toString?.() || intent.senderId,
          recipientId: intent.recipientId?.toString?.() || intent.recipientId,
          screen: "GiftIntentDetailsScreen",
        },
      })
    );

    console.log("✅ [GIFT] Gift intent accepted", {
      intentId: intent._id.toString(),
      tier: intent.tier,
    });

    return res.status(200).json({
      success: true,
      intentId: intent._id,
      status: intent.status,
    });
  } catch (error) {
    console.error("🔥 [GIFT] acceptGiftIntent error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to accept gift",
    });
  }
};


export const rejectGiftIntent = async (req, res) => {
  try {
    const { intentId } = req.params;
    const userId = req.user.id;

    const intent = await GiftIntent.findById(intentId);
    if (!intent) {
      return res
        .status(404)
        .json({ success: false, message: "Gift intent not found" });
    }

    // 🔒 In our current model: LOW gifts are "just sent", no rejection stage
    if (intent.tier === "LOW") {
      return res.status(400).json({
        success: false,
        message: "Low-cost gifts cannot be rejected",
      });
    }

    // 🔒 Only recipient can reject
    if (intent.recipientId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Only recipient can reject this gift",
      });
    }

    // 🔒 Can only reject while still waiting on recipient consent
    if (intent.status !== "AWAITING_RECIPIENT") {
      return res.status(400).json({
        success: false,
        message: "Gift intent cannot be rejected at this stage",
      });
    }

    intent.status = "CANCELLED";
    await intent.save();

    await notificationService.sendToUser(
      intent.senderId,
      notificationService.buildNotificationPayload({
        type: NOTIFICATION_TYPES.GIFT_INTENT_REJECTED,
        title: "Gift declined",
        body: "Your gift intent was declined.",
        data: {
          intentId: intent._id.toString(),
          chatId: intent.chatId?.toString?.() || intent.chatId,
          senderId: intent.senderId?.toString?.() || intent.senderId,
          recipientId: intent.recipientId?.toString?.() || intent.recipientId,
          screen: "GiftIntentDetailsScreen",
        },
      })
    );

    console.log("❌ [GIFT] Gift intent rejected", {
      intentId: intent._id.toString(),
      tier: intent.tier,
    });

    return res.status(200).json({
      success: true,
      intentId: intent._id,
      status: intent.status,
    });
  } catch (error) {
    console.error("🔥 [GIFT] rejectGiftIntent error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reject gift",
    });
  }
};

export const getGiftIntentDetails = async (req, res) => {
  try {
    const { intentId } = req.params;
    const userId = req.user.id;

    const intent = await GiftIntent.findById(intentId).lean();
    if (!intent) {
      return res.status(404).json({
        success: false,
        message: "Gift intent not found",
      });
    }

    const participantIds = [
      intent.senderId?.toString?.(),
      intent.recipientId?.toString?.(),
    ].filter(Boolean);

    if (!participantIds.includes(userId.toString())) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this gift intent",
      });
    }

    const mappedIntent = await mapGiftIntentForResponse(intent, userId);

    return res.status(200).json({
      success: true,
      intent: mappedIntent,
    });
  } catch (error) {
    console.error("🔥 [GIFT] getGiftIntentDetails error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch gift intent",
    });
  }
};




export const createGiftOrder = async (req, res) => {
  try {
    const { chatId } = req.params;
    const senderId = req.user.id;
    const { note } = req.body || {};

    console.log("🎁 [GIFT] createGiftOrder called", {
      chatId,
      senderId,
    });

    // 🔒 GiftOrder must come from a valid GiftIntent for this chat + sender
    // For now we allow latest intent in CREATED / ACCEPTED / PAID to be used,
    // depending on when you call this (pre- or post-payment wiring).
    const activeIntent = await GiftIntent.findOne({
      chatId,
      senderId,
      status: { $in: ["CREATED", "ACCEPTED", "PAID"] },
    }).sort({ createdAt: -1 });

    if (!activeIntent) {
      return res.status(400).json({
        success: false,
        message: "No active gift intent found for this chat",
      });
    }

    // 🔍 Load chat
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res
        .status(404)
        .json({ success: false, message: "Chat not found" });
    }

    // 🔒 Chat must be accepted
    if (chat.status !== "accepted") {
      return res.status(400).json({
        success: false,
        message: "Gift can only be sent in accepted chats",
      });
    }

    const senderIdStr = chat.senderId.toString();
    const receiverIdStr = chat.receiverId.toString();

    if (![senderIdStr, receiverIdStr].includes(senderId.toString())) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized for this chat",
      });
    }

    // 🎯 Determine recipient
    const recipientId =
      senderId.toString() === senderIdStr ? receiverIdStr : senderIdStr;

    // 📦 Load recipient profile (ADDRESS SOURCE OF TRUTH)
    const recipientProfile = await UserProfile.findById(recipientId);
    if (!recipientProfile || !recipientProfile.deliveryAddress) {
      return res.status(400).json({
        success: false,
        message: "Recipient has no delivery address set",
      });
    }

    // 🧊 Freeze delivery snapshot (stored in DB only; never sent to sender)
    const deliverySnapshot = {
      ...recipientProfile.deliveryAddress,
    };

    // 💰 Use total from intent (we don't trust client body for amount)
    const totalAmount = Number(activeIntent.totalAmount || 0);
    const items = activeIntent.items || [];
    const source = "FUSE_MANUAL";

    // 🧾 Create Gift Order
    const giftOrder = new GiftOrder({
      chatId,
      intentId: activeIntent._id, // ok even if not in schema; extra field is ignored if strict
      senderId,
      recipientId,
      tier: activeIntent.tier,
      items,
      source,
      totalAmount,
      deliverySnapshot,
      note: note || "",
      status: "CREATED",
    });

    await giftOrder.save();

    console.log("✅ [GIFT] Order created", {
      orderId: giftOrder._id.toString(),
      totalAmount,
      recipientId,
    });

    // ❗ DO NOT return address to sender
    return res.status(201).json({
      success: true,
      orderId: giftOrder._id,
      totalAmount,
      source,
      tier: activeIntent.tier,
    });
  } catch (error) {
    console.error("🔥 [GIFT] createGiftOrder error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create gift order",
    });
  }
};
