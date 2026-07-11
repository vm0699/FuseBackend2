/**
 * Shared match-establishment logic, extracted from SwipeController.js so that
 * both regular swipe-matching and Event Circle waves (Explore Iteration 2) can
 * create a match + chat through the exact same code path.
 *
 * This is a mechanical extraction — the logic below is unchanged from the
 * original SwipeController implementation, just relocated and parameterized.
 */
import Like from "../models/Like.js";
import Chat from "../models/ChatModel.js";
import UserProfile from "../models/UserProfile.js";
import { ensureChatTwilioChannel } from "./chatTwilioService.js";

const ACTIVE_CHAT_STATUSES = ["pending", "accepted"];

export const normalizePairKey = (firstUserId, secondUserId) =>
  [firstUserId.toString(), secondUserId.toString()].sort().join("|");

export const resolveActiveChatForPair = async ({ pairKey, userAId, userBId }) => {
  let chat = await Chat.findOne({
    pairKey,
    status: { $in: ACTIVE_CHAT_STATUSES },
  });

  if (!chat) {
    try {
      chat = await Chat.create({
        senderId: userAId,
        receiverId: userBId,
        status: "accepted",
        pairKey,
        participants: [userAId, userBId],
        lastActivityAt: new Date(),
      });
    } catch (err) {
      if (err?.code !== 11000) {
        throw err;
      }

      chat = await Chat.findOne({
        pairKey,
        status: { $in: ACTIVE_CHAT_STATUSES },
      });
    }
  } else if (chat.status === "pending") {
    chat.status = "accepted";
    chat.participants = [userAId, userBId];
    chat.lastActivityAt = new Date();
    await chat.save();
  }

  return chat;
};

export const buildMatchResponse = async ({
  loggedInUserId,
  swipedUserId,
  swipedUser,
  pairKey,
  existingChat = null,
}) => {
  const chat =
    existingChat ||
    (await resolveActiveChatForPair({
      pairKey,
      userAId: loggedInUserId,
      userBId: swipedUserId,
    }));

  if (!chat) {
    throw new Error("Failed to resolve active chat for matched pair");
  }

  try {
    await ensureChatTwilioChannel({
      chat,
      userAId: loggedInUserId,
      userBId: swipedUserId,
    });
  } catch (error) {
    console.log("Twilio channel provisioning skipped:", error?.message || error);
  }

  return {
    success: true,
    message: "Swipe recorded successfully",
    isMatch: true,
    swipeState: "matched",
    chatId: chat._id,
    twilioChannelSid:
      chat?.twilioChannelSid || chat?.twilioChatChannelSid || null,
    otherUser: {
      _id: swipedUser._id,
      name: swipedUser.name,
      photos: swipedUser.photos || [],
    },
  };
};

/**
 * Performs the DB-side "these two users are now matched" writes.
 * Identical to the inline block previously in SwipeController.handleSwipe.
 */
export const writeMatchState = async ({ userAId, userBId }) => {
  await Promise.all([
    UserProfile.updateOne(
      { _id: userAId },
      {
        $addToSet: {
          swipedRight: userBId,
          matches: userBId,
        },
        $pull: { swipedLeft: userBId },
      }
    ),
    UserProfile.updateOne(
      { _id: userBId },
      {
        $addToSet: {
          swipedRight: userAId,
          matches: userAId,
        },
        $pull: { swipedLeft: userAId },
      }
    ),
    // Upsert (not updateMany): on the swipe path both Like docs already exist here,
    // so this is a pure status flip — identical to the original behavior. On the
    // event-wave path neither doc exists yet, so this creates them; a mutual wave
    // deliberately overrides any prior "closed" Like from an earlier left-swipe.
    Like.findOneAndUpdate(
      { likerId: userAId, likedUserId: userBId },
      {
        $set: { status: "matched" },
        $setOnInsert: { likerId: userAId, likedUserId: userBId },
      },
      { upsert: true, setDefaultsOnInsert: true }
    ),
    Like.findOneAndUpdate(
      { likerId: userBId, likedUserId: userAId },
      {
        $set: { status: "matched" },
        $setOnInsert: { likerId: userBId, likedUserId: userAId },
      },
      { upsert: true, setDefaultsOnInsert: true }
    ),
  ]);
};

/**
 * Full match establishment used outside the swipe hot path (e.g. Event Circle
 * mutual waves): writes match state, tags the Like pair with attribution, and
 * builds the same response shape handleSwipe returns on a match.
 */
export const establishMatch = async ({ userAId, userBId, otherUserProfile, source = "swipe", eventId = null }) => {
  const pairKey = normalizePairKey(userAId, userBId);

  await writeMatchState({ userAId, userBId });

  if (source !== "swipe") {
    // Attribution only — does not affect Like's pending/matched/closed state machine.
    await Like.updateMany(
      {
        $or: [
          { likerId: userAId, likedUserId: userBId },
          { likerId: userBId, likedUserId: userAId },
        ],
      },
      { $set: { source, eventId } }
    ).catch(() => {});
  }

  return buildMatchResponse({
    loggedInUserId: userAId,
    swipedUserId: userBId,
    swipedUser: otherUserProfile,
    pairKey,
  });
};

export default {
  normalizePairKey,
  resolveActiveChatForPair,
  buildMatchResponse,
  writeMatchState,
  establishMatch,
};
