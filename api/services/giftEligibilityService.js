import mongoose from "mongoose";
import Chat from "../models/ChatModel.js";
import Message from "../models/MessageModel.js";
import Block from "../models/Block.js";
import Report from "../models/Report.js";
import GiftOrder, { GIFT_ORDER_ACTIVE_STATUSES } from "../models/GiftOrder.js";
import UserProfile from "../models/UserProfile.js";

/**
 * Gift eligibility + rate-limit rules (Phase 2 MVP).
 *
 * Reason codes returned to the client:
 *   CHAT_NOT_FOUND, NOT_CHAT_PARTICIPANT, CHAT_NOT_ACCEPTED,
 *   BOTH_USERS_MUST_CHAT_FIRST, BLOCKED_CHAT, SAFETY_HOLD,
 *   ACTIVE_ORDER_EXISTS, LOW_LIMIT_REACHED, MID_LIMIT_REACHED, UNKNOWN_ERROR
 */

const ACTIVE_REPORT_STATUSES = ["open", "reviewing", "action_taken"];

const getLegacyMessages = (chat) =>
  Array.isArray(chat?.messages) ? chat.messages : [];

export const getChatParticipantIds = (chat) => {
  const ids = [chat?.senderId, chat?.receiverId, ...(chat?.participants || [])]
    .filter(Boolean)
    .map((id) => id.toString());
  return Array.from(new Set(ids));
};

export const bothUsersHaveChatted = async (chatId, chat) => {
  const storedSenders = await Message.distinct("sender", { chatId });
  const uniqueSenders = new Set(
    [
      ...storedSenders.map((s) => s?.toString?.() || String(s)),
      ...getLegacyMessages(chat).map((m) => m?.sender?.toString?.()),
    ].filter(Boolean)
  );
  return uniqueSenders.size >= 2;
};

export const hasActiveGiftOrder = async (chatId) => {
  const count = await GiftOrder.countDocuments({
    chatId,
    status: { $in: GIFT_ORDER_ACTIVE_STATUSES },
  });
  return count > 0;
};

export const hasBlockBetweenUsers = async (userA, userB) => {
  if (!userA || !userB) return false;
  const block = await Block.findOne({
    $or: [
      { blockerId: userA, blockedId: userB },
      { blockerId: userB, blockedId: userA },
    ],
  }).lean();
  return Boolean(block);
};

export const hasSafetyHoldBetweenUsers = async (userA, userB) => {
  if (!userA || !userB) return false;
  const report = await Report.findOne({
    status: { $in: ACTIVE_REPORT_STATUSES },
    $or: [
      { reporterId: userA, reportedUserId: userB },
      { reporterId: userB, reportedUserId: userA },
    ],
  }).lean();
  return Boolean(report);
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

/**
 * Rate limits. Counts gift orders the sender has created in each window
 * (cancelled, declined, and refunded orders don't count against the user —
 * a decline shouldn't punish the sender's ability to gift someone else).
 *
 *   LOW: max 1 per chat per day,  max 2 per sender per week
 *   MID: max 1 per chat per week, max 2 per sender per month
 *
 * Returns { low: { canSend, reason }, mid: { canSend, reason } }.
 */
export const checkGiftRateLimits = async ({ senderId, chatId }) => {
  const notCancelled = {
    status: { $nin: ["CANCELLED", "REFUND_REQUIRED", "REFUNDED"] },
  };

  const [
    lowChatToday,
    lowSenderWeek,
    midChatWeek,
    midSenderMonth,
  ] = await Promise.all([
    GiftOrder.countDocuments({
      senderId,
      chatId,
      tier: "LOW",
      createdAt: { $gte: startOfToday() },
      ...notCancelled,
    }),
    GiftOrder.countDocuments({
      senderId,
      tier: "LOW",
      createdAt: { $gte: daysAgo(7) },
      ...notCancelled,
    }),
    GiftOrder.countDocuments({
      senderId,
      chatId,
      tier: "MID",
      createdAt: { $gte: daysAgo(7) },
      ...notCancelled,
    }),
    GiftOrder.countDocuments({
      senderId,
      tier: "MID",
      createdAt: { $gte: daysAgo(30) },
      ...notCancelled,
    }),
  ]);

  const lowReason =
    lowChatToday >= 1
      ? "LOW_LIMIT_REACHED"
      : lowSenderWeek >= 2
      ? "LOW_LIMIT_REACHED"
      : null;

  const midReason =
    midChatWeek >= 1
      ? "MID_LIMIT_REACHED"
      : midSenderMonth >= 2
      ? "MID_LIMIT_REACHED"
      : null;

  return {
    low: { canSend: !lowReason, reason: lowReason },
    mid: { canSend: !midReason, reason: midReason },
  };
};

/**
 * Full eligibility evaluation for a chat + requesting user.
 * Returns a structured object suitable to send straight to the client.
 */
export const evaluateGiftEligibility = async ({ chatId, userId }) => {
  const base = {
    eligible: false,
    reason: null,
    chatStatus: null,
    bothUsersChatted: false,
    activeOrderExists: false,
    limits: {
      low: { canSend: false, reason: null },
      mid: { canSend: false, reason: null },
    },
  };

  if (!chatId || !mongoose.isValidObjectId(chatId)) {
    return { ...base, reason: "CHAT_NOT_FOUND" };
  }

  const chat = await Chat.findById(chatId);
  if (!chat) return { ...base, reason: "CHAT_NOT_FOUND" };

  base.chatStatus = chat.status;

  const participantIds = getChatParticipantIds(chat);
  if (!participantIds.includes(userId.toString())) {
    return { ...base, reason: "NOT_CHAT_PARTICIPANT" };
  }

  const otherId = participantIds.find((id) => id !== userId.toString());

  if (chat.status !== "accepted") {
    return { ...base, reason: "CHAT_NOT_ACCEPTED" };
  }

  base.bothUsersChatted = await bothUsersHaveChatted(chat._id, chat);
  if (!base.bothUsersChatted) {
    return { ...base, reason: "BOTH_USERS_MUST_CHAT_FIRST" };
  }

  if (await hasBlockBetweenUsers(userId, otherId)) {
    return { ...base, reason: "BLOCKED_CHAT" };
  }

  if (await hasSafetyHoldBetweenUsers(userId, otherId)) {
    return { ...base, reason: "SAFETY_HOLD" };
  }

  // Recipient must have gifts enabled
  const recipient = await UserProfile.findById(otherId).select("safetyPreferences").lean();
  if (recipient?.safetyPreferences?.allowGifts === false) {
    return { ...base, reason: "RECIPIENT_GIFTS_DISABLED" };
  }

  base.activeOrderExists = await hasActiveGiftOrder(chat._id);
  if (base.activeOrderExists) {
    return { ...base, reason: "ACTIVE_ORDER_EXISTS" };
  }

  base.limits = await checkGiftRateLimits({ senderId: userId, chatId: chat._id });

  // Eligible to open the catalog if at least one tier can be sent.
  const anyTierAvailable = base.limits.low.canSend || base.limits.mid.canSend;
  if (!anyTierAvailable) {
    return { ...base, reason: base.limits.low.reason || base.limits.mid.reason };
  }

  return { ...base, eligible: true, reason: null, recipientId: otherId };
};

export default {
  evaluateGiftEligibility,
  bothUsersHaveChatted,
  hasActiveGiftOrder,
  hasBlockBetweenUsers,
  hasSafetyHoldBetweenUsers,
  checkGiftRateLimits,
  getChatParticipantIds,
};
