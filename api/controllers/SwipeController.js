import Like from "../models/Like.js";
import Chat from "../models/ChatModel.js";
import UserProfile from "../models/UserProfile.js";
import client from "../config/twilio.js";
import { deriveSwipeState, getSwipeTransition } from "../lib/swipeStateMachine.js";

const ACTIVE_CHAT_STATUSES = ["pending", "accepted"];

const normalizePairKey = (firstUserId, secondUserId) =>
  [firstUserId.toString(), secondUserId.toString()].sort().join("|");

const buildNoMatchResponse = ({
  swipeState,
  message = "Swipe recorded successfully",
}) => ({
  success: true,
  message,
  isMatch: false,
  swipeState,
});

const ensureTwilioChannelForMatch = async ({
  chatId,
  userAId,
  userBId,
  pairKey,
}) => {
  let chat = await Chat.findById(chatId);
  if (!chat || !ACTIVE_CHAT_STATUSES.includes(chat.status)) {
    return null;
  }

  if (chat.twilioChannelSid || chat.twilioChatChannelSid) {
    return chat;
  }

  try {
    const service = client.chat.v2.services(process.env.TWILIO_CHAT_SERVICE_SID);
    const friendlyName = `${userAId}-${userBId}`;
    const uniqueName = `chat-${pairKey}`;
    const created = await service.channels.create({ friendlyName, uniqueName });

    const updatedChat = await Chat.findOneAndUpdate(
      {
        _id: chatId,
        status: { $in: ACTIVE_CHAT_STATUSES },
        $or: [
          { twilioChannelSid: { $exists: false } },
          { twilioChannelSid: null },
          { twilioChannelSid: "" },
        ],
      },
      {
        $set: {
          twilioChannelSid: created.sid,
          twilioChatChannelSid: created.sid,
          participants: [userAId, userBId],
        },
      },
      { new: true }
    );

    return updatedChat || (await Chat.findById(chatId));
  } catch (err) {
    console.log("Twilio channel creation skipped:", err?.message);
    return await Chat.findById(chatId);
  }
};

const resolveActiveChatForPair = async ({ pairKey, userAId, userBId }) => {
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
        messages: [],
        pairKey,
        participants: [userAId, userBId],
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
    await chat.save();
  }

  return chat;
};

const buildMatchResponse = async ({
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

  const channelChat = await ensureTwilioChannelForMatch({
    chatId: chat._id,
    userAId: loggedInUserId,
    userBId: swipedUserId,
    pairKey,
  });

  return {
    success: true,
    message: "Swipe recorded successfully",
    isMatch: true,
    swipeState: "matched",
    chatId: chat._id,
    twilioChannelSid:
      channelChat?.twilioChannelSid || channelChat?.twilioChatChannelSid || null,
    otherUser: {
      _id: swipedUser._id,
      name: swipedUser.name,
      photos: swipedUser.photos || [],
    },
  };
};

export const handleSwipe = async (req, res) => {
  try {
    const { id: loggedInUserId } = req.user;
    const { swipedUserId, action } = req.body;

    if (!swipedUserId || !["like", "dislike"].includes(action)) {
      return res.status(400).json({ success: false, message: "Invalid request" });
    }

    if (loggedInUserId.toString() === swipedUserId.toString()) {
      return res.status(400).json({
        success: false,
        message: "Users cannot swipe on themselves",
      });
    }

    const pairKey = normalizePairKey(loggedInUserId, swipedUserId);

    const [loggedInUser, swipedUser, outgoingLike, reciprocalLike, activeChat] =
      await Promise.all([
        UserProfile.findById(loggedInUserId).select(
          "_id swipedUserIds swipedRight swipedLeft matches"
        ),
        UserProfile.findById(swipedUserId).select("_id name photos"),
        Like.findOne({
          likerId: loggedInUserId,
          likedUserId: swipedUserId,
        }).select("_id status"),
        Like.findOne({
          likerId: swipedUserId,
          likedUserId: loggedInUserId,
        }).select("_id status"),
        Chat.findOne({
          pairKey,
          status: { $in: ACTIVE_CHAT_STATUSES },
        }).select("_id status twilioChannelSid twilioChatChannelSid"),
      ]);

    if (!loggedInUser || !swipedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const currentState = deriveSwipeState({
      actorProfile: loggedInUser,
      targetUserId: swipedUserId,
      outgoingLike,
      reciprocalLike,
      activeChat,
    });
    const transition = getSwipeTransition({ currentState, action });

    if (transition === "noop_matched") {
      return res.status(200).json(
        await buildMatchResponse({
          loggedInUserId,
          swipedUserId,
          swipedUser,
          pairKey,
          existingChat: activeChat,
        })
      );
    }

    if (transition === "noop_disliked") {
      return res
        .status(200)
        .json(buildNoMatchResponse({ swipeState: "disliked" }));
    }

    if (transition === "record_dislike") {
      await Promise.all([
        UserProfile.updateOne(
          { _id: loggedInUserId },
          {
            $addToSet: {
              swipedUserIds: swipedUserId,
              swipedLeft: swipedUserId,
            },
            $pull: { swipedRight: swipedUserId },
          }
        ),
        Like.updateOne(
          {
            likerId: loggedInUserId,
            likedUserId: swipedUserId,
            status: { $ne: "matched" },
          },
          { $set: { status: "closed" } }
        ),
      ]);

      return res
        .status(200)
        .json(buildNoMatchResponse({ swipeState: "disliked" }));
    }

    await Promise.all([
      Like.findOneAndUpdate(
        { likerId: loggedInUserId, likedUserId: swipedUserId },
        {
          $set: { status: "pending" },
          $setOnInsert: {
            likerId: loggedInUserId,
            likedUserId: swipedUserId,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ),
      UserProfile.updateOne(
        { _id: loggedInUserId },
        {
          $addToSet: {
            swipedUserIds: swipedUserId,
            swipedRight: swipedUserId,
          },
          $pull: { swipedLeft: swipedUserId },
        }
      ),
    ]);

    const reciprocalLikeAfterUpdate =
      reciprocalLike ||
      (await Like.findOne({
        likerId: swipedUserId,
        likedUserId: loggedInUserId,
      }).select("_id status"));

    if (!reciprocalLikeAfterUpdate || reciprocalLikeAfterUpdate.status === "closed") {
      return res
        .status(200)
        .json(buildNoMatchResponse({ swipeState: "liked_pending" }));
    }

    await Promise.all([
      UserProfile.updateOne(
        { _id: loggedInUserId },
        {
          $addToSet: {
            swipedRight: swipedUserId,
            matches: swipedUserId,
          },
          $pull: { swipedLeft: swipedUserId },
        }
      ),
      UserProfile.updateOne(
        { _id: swipedUserId },
        {
          $addToSet: {
            swipedRight: loggedInUserId,
            matches: loggedInUserId,
          },
          $pull: { swipedLeft: loggedInUserId },
        }
      ),
      Like.updateMany(
        {
          $or: [
            { likerId: loggedInUserId, likedUserId: swipedUserId },
            { likerId: swipedUserId, likedUserId: loggedInUserId },
          ],
        },
        { $set: { status: "matched" } }
      ),
    ]);

    return res.status(200).json(
      await buildMatchResponse({
        loggedInUserId,
        swipedUserId,
        swipedUser,
        pairKey,
        existingChat: activeChat,
      })
    );
  } catch (error) {
    console.error("ERROR IN HARDENED handleSwipe:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while handling swipe.",
    });
  }
};
