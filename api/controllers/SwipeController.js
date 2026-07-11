import Like from "../models/Like.js";
import Chat from "../models/ChatModel.js";
import UserProfile from "../models/UserProfile.js";
import SwipeRecord from "../models/SwipeRecord.js";
import { deriveSwipeState, getSwipeTransition } from "../lib/swipeStateMachine.js";
import { normalizePairKey, buildMatchResponse, writeMatchState } from "../services/matchService.js";

const ACTIVE_CHAT_STATUSES = ["pending", "accepted"];

const buildNoMatchResponse = ({
  swipeState,
  message = "Swipe recorded successfully",
}) => ({
  success: true,
  message,
  isMatch: false,
  swipeState,
});

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
        }).select("_id status pairKey twilioChannelSid twilioChatChannelSid twilioMembersInitialized"),
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

      // Dual-write to SwipeRecord (fire and forget — non-blocking)
      SwipeRecord.findOneAndUpdate(
        { swiperId: loggedInUserId, swipedId: swipedUserId },
        { $set: { action: "dislike" } },
        { upsert: true }
      ).catch(() => {});

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

    // Dual-write to SwipeRecord (fire and forget — non-blocking)
    SwipeRecord.findOneAndUpdate(
      { swiperId: loggedInUserId, swipedId: swipedUserId },
      { $set: { action: "like" } },
      { upsert: true }
    ).catch(() => {});

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

    await writeMatchState({ userAId: loggedInUserId, userBId: swipedUserId });

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
