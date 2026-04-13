import { Router } from "express";
import Like from "../models/Like.js";
import Chat from "../models/ChatModel.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = Router();

const profileSelection =
  "_id name username photos dateOfBirth gender height interests values prompts pronouns sexuality work jobTitle college educationLevel homeTown religion zodiacSign politics ethnicity drinking smoking marijuana drugs datingIntentions relationshipType children familyPlans pets languages";

router.post("/like", authMiddleware, async (req, res) => {
  try {
    const { likedUserId } = req.body;
    const likerId = req.user.id;

    if (!likedUserId) {
      return res
        .status(400)
        .json({ success: false, message: "Liked user ID missing" });
    }

    const like = await Like.findOneAndUpdate(
      { likerId, likedUserId },
      { $setOnInsert: { likerId, likedUserId, status: "pending" } },
      { upsert: true, new: true }
    );

    return res
      .status(201)
      .json({ success: true, message: "User liked successfully", like });
  } catch (error) {
    console.error("Error liking user:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/likedyou", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const existingChats = await Chat.find({
      $or: [{ senderId: userId }, { receiverId: userId }],
    })
      .select("senderId receiverId")
      .lean();

    const excludedUserIds = new Set();
    for (const chat of existingChats) {
      if (chat.senderId?.toString() !== userId) {
        excludedUserIds.add(chat.senderId?.toString());
      }
      if (chat.receiverId?.toString() !== userId) {
        excludedUserIds.add(chat.receiverId?.toString());
      }
    }

    const likes = await Like.find({
      likedUserId: userId,
      $or: [{ status: "pending" }, { status: { $exists: false } }],
      likerId: { $nin: Array.from(excludedUserIds).filter(Boolean) },
    })
      .sort({ createdAt: -1, _id: -1 })
      .populate("likerId", profileSelection)
      .lean();

    const likeEntries = (likes || [])
      .map((like) => {
        const liker = like.likerId;
        if (!liker) return null;

        return {
          _id: liker._id,
          name: liker.name,
          photos: liker.photos || [],
          status: "pending",
          complimentPreview: null,
          chatId: null,
          twilioChannelSid: null,
          dateOfBirth: liker.dateOfBirth,
          gender: liker.gender,
          height: liker.height,
          interests: liker.interests || [],
          values: liker.values || [],
          prompts: liker.prompts || [],
          pronouns: liker.pronouns || "",
          sexuality: liker.sexuality || "",
          work: liker.work || "",
          jobTitle: liker.jobTitle || "",
          college: liker.college || "",
          educationLevel: liker.educationLevel || "",
          homeTown: liker.homeTown || "",
          religion: liker.religion || "",
          zodiacSign: liker.zodiacSign || "",
          politics: liker.politics || "",
          ethnicity: liker.ethnicity || "",
          drinking: liker.drinking || "",
          smoking: liker.smoking || "",
          marijuana: liker.marijuana || "",
          drugs: liker.drugs || "",
          datingIntentions: liker.datingIntentions || "",
          relationshipType: liker.relationshipType || "",
          children: liker.children || "",
          familyPlans: liker.familyPlans || "",
          pets: liker.pets || "",
          languages: liker.languages || [],
          createdAt: like.createdAt || like.updatedAt || null,
        };
      })
      .filter(Boolean);

    const pendingChats = await Chat.find({
      receiverId: userId,
      status: "pending",
    })
      .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
      .populate("senderId", profileSelection)
      .lean();

    const chatEntries = (pendingChats || [])
      .map((chat) => {
        const sender = chat.senderId;
        if (!sender) return null;

        const lastMsg =
          chat.messages?.length > 0
            ? chat.messages[chat.messages.length - 1]
            : null;

        return {
          _id: sender._id,
          name: sender.name,
          photos: sender.photos || [],
          status: "pending",
          complimentPreview: lastMsg ? lastMsg.message : null,
          chatId: chat._id,
          twilioChannelSid:
            chat.twilioChannelSid || chat.twilioChatChannelSid || null,
          dateOfBirth: sender.dateOfBirth,
          gender: sender.gender,
          height: sender.height,
          interests: sender.interests || [],
          values: sender.values || [],
          prompts: sender.prompts || [],
          pronouns: sender.pronouns || "",
          sexuality: sender.sexuality || "",
          work: sender.work || "",
          jobTitle: sender.jobTitle || "",
          college: sender.college || "",
          educationLevel: sender.educationLevel || "",
          homeTown: sender.homeTown || "",
          religion: sender.religion || "",
          zodiacSign: sender.zodiacSign || "",
          politics: sender.politics || "",
          ethnicity: sender.ethnicity || "",
          drinking: sender.drinking || "",
          smoking: sender.smoking || "",
          marijuana: sender.marijuana || "",
          drugs: sender.drugs || "",
          datingIntentions: sender.datingIntentions || "",
          relationshipType: sender.relationshipType || "",
          children: sender.children || "",
          familyPlans: sender.familyPlans || "",
          pets: sender.pets || "",
          languages: sender.languages || [],
          createdAt: chat.updatedAt || chat.createdAt || null,
        };
      })
      .filter(Boolean);

    return res.status(200).json({
      success: true,
      users: [...likeEntries, ...chatEntries],
    });
  } catch (error) {
    console.error("Error fetching likes:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
