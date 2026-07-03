import Chat from "../models/ChatModel.js";
import Message from "../models/MessageModel.js";
import UserProfile from "../models/UserProfile.js";
import GiftOrder from "../models/GiftOrder.js";
import GiftIntent from "../models/GiftIntentModel.js";
import GiftCatalogItem from "../models/GiftCatalogItem.js";
import Block from "../models/Block.js";
import client from "../config/twilio.js";
import dotenv from "dotenv";
import twilio from "twilio";
import notificationService from "../services/notificationService.js";
import { ensureChatTwilioChannel } from "../services/chatTwilioService.js";
import { NOTIFICATION_TYPES } from "../services/notifications/notificationTypes.js";
import { evaluateGiftEligibility } from "../services/giftEligibilityService.js";

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

  // Surface any order created from this intent so the UI can jump to tracking.
  // Address is never included here.
  const linkedOrder = await GiftOrder.findOne({ intentId: populatedIntent._id })
    .select("_id orderCode status")
    .lean();

  return {
    intentId: populatedIntent._id,
    chatId: populatedIntent.chatId,
    tier: populatedIntent.tier,
    status: populatedIntent.status,
    totalAmount: populatedIntent.totalAmount,
    items: populatedIntent.items || [],
    catalogSnapshot: populatedIntent.catalogSnapshot || null,
    quantity: populatedIntent.quantity || 1,
    senderId: populatedIntent.senderId?._id || populatedIntent.senderId,
    recipientId: populatedIntent.recipientId?._id || populatedIntent.recipientId,
    createdAt: populatedIntent.createdAt,
    updatedAt: populatedIntent.updatedAt,
    order: linkedOrder
      ? {
          orderId: linkedOrder._id,
          orderCode: linkedOrder.orderCode || null,
          status: linkedOrder.status,
        }
      : null,
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

const normalizeMessageTimestamp = (value) => {
  const date = value ? new Date(value) : null;
  return Number.isNaN(date?.getTime?.()) ? new Date() : date;
};

const mapStoredMessageToResponse = (messageDoc, fallbackId = null) => ({
  id:
    messageDoc?._id?.toString?.() ||
    messageDoc?.id?.toString?.() ||
    fallbackId,
  authorId: messageDoc?.sender?.toString?.() || messageDoc?.sender || null,
  body: messageDoc?.message || "",
  timestamp: normalizeMessageTimestamp(messageDoc?.timestamp),
});

const getLegacyMessages = (chat) =>
  Array.isArray(chat?.messages) ? chat.messages : [];

const getLastLegacyMessage = (chat) => {
  const legacyMessages = getLegacyMessages(chat);
  return legacyMessages.length ? legacyMessages[legacyMessages.length - 1] : null;
};

const getChatPreviewMessage = (chat) => {
  if (chat?.lastMessageSummary && chat?.lastMessageAt) {
    return {
      sender: chat.lastMessageSenderId || null,
      message: chat.lastMessageSummary,
      timestamp: chat.lastMessageAt,
    };
  }

  const legacyLastMessage = getLastLegacyMessage(chat);
  return legacyLastMessage
    ? {
        sender: legacyLastMessage.sender || null,
        message: legacyLastMessage.message,
        timestamp: legacyLastMessage.timestamp,
      }
    : null;
};

const applyLastMessageMetadata = (chat, { senderId, message, timestamp }) => {
  const normalizedTimestamp = normalizeMessageTimestamp(timestamp);
  chat.lastMessageSummary = message;
  chat.lastMessageAt = normalizedTimestamp;
  chat.lastMessageSenderId = senderId || null;
  chat.lastActivityAt = normalizedTimestamp;
};

const clearLastMessageMetadata = (chat) => {
  chat.lastMessageSummary = null;
  chat.lastMessageAt = null;
  chat.lastMessageSenderId = null;
  chat.lastActivityAt = new Date();
};

const getStoredAndLegacyMessages = async (chatId, chat) => {
  const storedMessages = await Message.find({ chatId })
    .sort({ timestamp: 1, _id: 1 })
    .lean();

  const normalizedStoredMessages = storedMessages.map((messageDoc) =>
    mapStoredMessageToResponse(messageDoc)
  );

  const normalizedLegacyMessages = getLegacyMessages(chat)
    .map((messageDoc, index) =>
      mapStoredMessageToResponse(
        messageDoc,
        `${chatId.toString()}_legacy_${index}`
      )
    )
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
    );

  const mergedMessages = [...normalizedLegacyMessages, ...normalizedStoredMessages].sort(
    (left, right) => {
      const timestampDiff =
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
      if (timestampDiff !== 0) return timestampDiff;
      return String(left.id).localeCompare(String(right.id));
    }
  );

  return mergedMessages;
};

const hasRecentLegacyDuplicate = ({
  chat,
  senderId,
  message,
  windowMs,
}) => {
  const threshold = Date.now() - windowMs;

  return getLegacyMessages(chat)
    .slice(-10)
    .some((legacyMessage) => {
      const sameSender =
        legacyMessage?.sender?.toString?.() === senderId.toString();
      const sameText = legacyMessage?.message === message;
      const timestamp = legacyMessage?.timestamp
        ? new Date(legacyMessage.timestamp).getTime()
        : 0;

      return sameSender && sameText && timestamp >= threshold;
    });
};

const appendComplimentMessage = async ({ chat, senderId, compliment }) => {
  const trimmed = (compliment || "").trim();
  if (!trimmed) return null;

  const duplicateThreshold = new Date(Date.now() - 5 * 60 * 1000);
  const recentDuplicate =
    (await Message.findOne({
      chatId: chat._id,
      sender: senderId,
      message: trimmed,
      timestamp: { $gte: duplicateThreshold },
    })
      .sort({ timestamp: -1, _id: -1 })
      .lean()) ||
    (hasRecentLegacyDuplicate({
      chat,
      senderId,
      message: trimmed,
      windowMs: 5 * 60 * 1000,
    })
      ? { message: trimmed }
      : null);

  if (!recentDuplicate) {
    const timestamp = new Date();
    if (chat.twilioChannelSid || chat.twilioChatChannelSid) {
      await client.chat
        .services(process.env.TWILIO_CHAT_SERVICE_SID)
        .channels(chat.twilioChannelSid || chat.twilioChatChannelSid)
        .messages.create({ from: senderId.toString(), body: trimmed });
    }
    await Message.create({
      chatId: chat._id,
      sender: senderId,
      message: trimmed,
      timestamp,
    });
    applyLastMessageMetadata(chat, {
      senderId,
      message: trimmed,
      timestamp,
    });
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
    })
      .select(
        "senderId receiverId pairKey status participants twilioChatChannelSid twilioChannelSid twilioMembersInitialized lastMessageSummary lastMessageAt lastMessageSenderId lastActivityAt messages"
      )
      .slice("messages", -5);

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
        participants: [senderId, swipedUserId],
      });
    }

    chat.pairKey = pairKey;
    ensureParticipantIds(chat, senderId, swipedUserId);

    const channelSid = await ensureChatTwilioChannel({
      chat,
      userAId: senderId,
      userBId: swipedUserId,
    });

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
    })
      .sort({ lastActivityAt: -1, updatedAt: -1, _id: -1 })
      .select(
        "senderId receiverId twilioChatChannelSid twilioChannelSid status lastMessageSummary lastMessageAt lastMessageSenderId lastActivityAt messages"
      )
      .slice("messages", -1)
      .populate("receiverId senderId");

    const formatted = (chats || [])
      .map((chat) => {
        const isCurrentUserSender = chat.senderId?._id?.toString() === userId;
        const otherUser = isCurrentUserSender ? chat.receiverId : chat.senderId;
        if (!otherUser) return null;
        if (blockedCounterpartIds.has(otherUser._id?.toString?.() || otherUser._id?.toString())) {
          return null;
        }

        const lastMsg = getChatPreviewMessage(chat);

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

    const chat = await Chat.findById(chatId)
      .slice("messages", -1)
      .populate("senderId receiverId");
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

    const complimentPreview = getChatPreviewMessage(chat)?.message || null;

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
        chat.lastActivityAt = new Date();
        ensureParticipantIds(
          chat,
          chat.senderId?._id || chat.senderId,
          chat.receiverId?._id || chat.receiverId
        );
        await ensureChatTwilioChannel({
          chat,
          userAId: chat.senderId?._id || chat.senderId,
          userBId: chat.receiverId?._id || chat.receiverId,
        });
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
        chat.lastActivityAt = new Date();
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
    const storedMessageCount = await Message.countDocuments({ chatId: chat._id });
    const deletedMessageCount = storedMessageCount + (chat.messages?.length || 0);
    await Message.deleteMany({ chatId: chat._id });
    chat.messages = [];

    chat.status = "closed";
    clearLastMessageMetadata(chat);
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

    const messages = await getStoredAndLegacyMessages(chat._id, chat);

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

    const chat = await Chat.findById(chatId)
      .select(
        "senderId receiverId pairKey status participants twilioChatChannelSid twilioChannelSid lastMessageSummary lastMessageAt lastMessageSenderId lastActivityAt messages"
      )
      .slice("messages", -10);
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
    const duplicateThreshold = new Date(Date.now() - 30 * 1000);
    const recent =
      (await Message.findOne({
        chatId: chat._id,
        sender: userId,
        message: trimmed,
        timestamp: { $gte: duplicateThreshold },
      })
        .sort({ timestamp: -1, _id: -1 })
        .lean()) ||
      (hasRecentLegacyDuplicate({
        chat,
        senderId: userId,
        message: trimmed,
        windowMs: 30 * 1000,
      })
        ? { message: trimmed }
        : null);

    if (recent) {
      console.log("🟣 [PHASE 3] Duplicate prevented", {
        chatId,
        message: trimmed,
      });
      return res.status(200).json({ success: true, duplicated: true });
    }

    const lastMessage = await Message.create({
      chatId: chat._id,
      sender: userId,
      message: trimmed,
      timestamp: new Date(),
    });

    applyLastMessageMetadata(chat, {
      senderId: userId,
      message: trimmed,
      timestamp: lastMessage.timestamp,
    });
    await chat.save();

    console.log("🟣 [PHASE 3] Message saved to DB", {
      chatId: chat._id.toString(),
      messageId: lastMessage?._id?.toString?.() || lastMessage?._id,
    });

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


// 🎁 GET /api/chat/:chatId/gift/eligibility
export const getGiftEligibility = async (req, res) => {
  try {
    const { chatId } = req.params;
    const result = await evaluateGiftEligibility({
      chatId,
      userId: req.user.id,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error("🔥 [GIFT] getGiftEligibility error:", error);
    // Fail closed: report not eligible so the client safely hides gifting.
    return res.status(200).json({
      success: true,
      eligible: false,
      reason: "UNKNOWN_ERROR",
      chatStatus: null,
      bothUsersChatted: false,
      activeOrderExists: false,
      limits: {
        low: { canSend: false, reason: null },
        mid: { canSend: false, reason: null },
      },
    });
  }
};

export const createGiftIntent = async (req, res) => {
  try {
    const { chatId } = req.params;
    const senderId = req.user.id;
    const { catalogItemId } = req.body || {};
    // MVP: quantity is fixed at 1.
    const quantity = 1;

    if (!chatId || !catalogItemId) {
      return res
        .status(400)
        .json({ success: false, message: "catalogItemId is required" });
    }

    // 🔒 Full eligibility gate (accepted chat, both chatted, no block/report,
    //    no active order, rate limits). Source of truth for who the recipient is.
    const eligibility = await evaluateGiftEligibility({ chatId, userId: senderId });
    if (!eligibility.eligible) {
      return res.status(400).json({
        success: false,
        message: "Gifting is not available for this chat right now",
        reason: eligibility.reason,
        eligibility,
      });
    }

    const recipientId = eligibility.recipientId;

    // 🎁 Catalog is the only source of truth for tier + price.
    const item = await GiftCatalogItem.findById(catalogItemId);
    if (!item || !item.isActive || !["LOW", "MID"].includes(item.tier)) {
      return res
        .status(400)
        .json({ success: false, message: "Gift is not available" });
    }

    const tier = item.tier;

    // 🔒 Enforce the tier-specific rate limit from the same eligibility result.
    const tierLimit =
      tier === "LOW" ? eligibility.limits.low : eligibility.limits.mid;
    if (!tierLimit.canSend) {
      return res.status(400).json({
        success: false,
        message:
          tier === "LOW"
            ? "You've reached the limit for low-cost gifts"
            : "You've reached the limit for mid-cost gifts",
        reason: tierLimit.reason,
      });
    }

    // 💰 Amount computed entirely on the backend from the catalog snapshot.
    const totalAmount = Number(item.finalAmount) * quantity;

    const catalogSnapshot = {
      name: item.name,
      description: item.description || "",
      tier: item.tier,
      imageUrl: item.imageUrl || "",
      category: item.category || "",
      occasion: item.occasion || "",
      price: item.price,
      platformFee: item.platformFee,
      deliveryFee: item.deliveryFee,
      finalAmount: item.finalAmount,
    };

    const giftIntent = await GiftIntent.create({
      chatId,
      senderId,
      recipientId,
      tier,
      catalogItemId: item._id,
      catalogSnapshot,
      quantity,
      // Backward-compatible single line item.
      items: [
        {
          itemId: item._id.toString(),
          name: item.name,
          quantity,
          price: item.finalAmount,
          source: "FUSE_MANUAL",
        },
      ],
      totalAmount,
      status: "CREATED",
      rulesSnapshot: {
        lowLimit: 499,
        midLimit: 2999,
        requiresRecipientConsent: false,
        requiresRecipientPayment: false,
      },
    });

    // No recipient notification here — payment-first. Recipient is notified
    // only once payment succeeds and an order exists (avoids "buying attention").

    return res.status(201).json({
      success: true,
      giftIntentId: giftIntent._id,
      intent: {
        intentId: giftIntent._id,
        chatId,
        tier,
        status: giftIntent.status,
        catalogSnapshot,
        quantity,
      },
      amountBreakdown: {
        price: item.price,
        platformFee: item.platformFee,
        deliveryFee: item.deliveryFee,
        total: totalAmount,
        currency: "INR",
      },
      nextAction: "PROCEED_TO_PAYMENT",
    });
  } catch (err) {
    console.error("🔥 createGiftIntent error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to create gift intent",
    });
  }
};


// NOTE: acceptGiftIntent / rejectGiftIntent were removed in Phase 2.
// Gifting is now payment-first (no recipient consent step). Recipients can
// decline a paid order before fulfilment via POST /api/gifts/orders/:orderId/decline.

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




// NOTE: the legacy createGiftOrder endpoint was removed in Phase 2.
// Orders are now created automatically after a successful payment in
// GiftPaymentController.confirmGiftPayment (with a frozen address snapshot).
