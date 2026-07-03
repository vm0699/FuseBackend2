import mongoose from "mongoose";
import GiftCatalogItem from "../models/GiftCatalogItem.js";
import ChatModel from "../models/ChatModel.js";
import UserProfile from "../models/UserProfile.js";

/**
 * Public (sender-facing) shape of a catalog item.
 * Sender sees a single "you pay" finalAmount — fee lines are not surfaced.
 */
const serializeCatalogItem = (item) => ({
  itemId: item._id.toString(),
  name: item.name,
  description: item.description || "",
  tier: item.tier,
  imageUrl: item.imageUrl || "",
  category: item.category || "",
  occasion: item.occasion || "",
  amount: item.finalAmount,
  currency: "INR",
});

const normalizeTags = (arr = []) =>
  Array.from(
    new Set(
      (Array.isArray(arr) ? arr : [])
        .map((t) => String(t || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );

/**
 * Resolve the recipient of a chat relative to the requesting user, so we can
 * compute interest-matched suggestions. Returns null if not resolvable.
 */
const resolveRecipientId = async (chatId, requesterId) => {
  if (!chatId || !mongoose.isValidObjectId(chatId)) return null;
  const chat = await ChatModel.findById(chatId).select(
    "senderId receiverId participants"
  );
  if (!chat) return null;

  const ids = [
    chat.senderId,
    chat.receiverId,
    ...(Array.isArray(chat.participants) ? chat.participants : []),
  ]
    .filter(Boolean)
    .map((id) => id.toString());

  const other = ids.find((id) => id !== String(requesterId));
  return other || null;
};

/**
 * GET /api/gifts/catalog?chatId=&recipientId=
 * Returns active LOW/MID items grouped by tier, plus a "suggested" set matched
 * to the recipient's profile interests (interests are already public on
 * profiles, so this exposes nothing new).
 */
export const getGiftCatalog = async (req, res) => {
  try {
    const items = await GiftCatalogItem.find({
      isActive: true,
      tier: { $in: ["LOW", "MID"] },
    }).sort({ sortOrder: 1, createdAt: 1 });

    const serialized = items.map(serializeCatalogItem);

    const low = serialized.filter((i) => i.tier === "LOW");
    const mid = serialized.filter((i) => i.tier === "MID");

    // Build interest-matched suggestions if we can resolve a recipient.
    let suggested = [];
    let recipientId = req.query.recipientId || null;
    if (!recipientId && req.query.chatId) {
      recipientId = await resolveRecipientId(req.query.chatId, req.user.id);
    }

    if (recipientId && mongoose.isValidObjectId(recipientId)) {
      const recipient = await UserProfile.findById(recipientId).select(
        "interests"
      );
      const interestSet = new Set(normalizeTags(recipient?.interests || []));
      if (interestSet.size) {
        suggested = items
          .filter((item) =>
            normalizeTags(item.interestTags).some((tag) => interestSet.has(tag))
          )
          .slice(0, 6)
          .map(serializeCatalogItem);
      }
    }

    return res.status(200).json({
      success: true,
      catalog: { low, mid },
      suggested,
    });
  } catch (error) {
    console.error("❌ [getGiftCatalog] error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to load catalog" });
  }
};

/**
 * GET /api/gifts/catalog/:itemId
 */
export const getGiftCatalogItem = async (req, res) => {
  try {
    const { itemId } = req.params;
    if (!mongoose.isValidObjectId(itemId)) {
      return res.status(400).json({ success: false, message: "Invalid item id" });
    }

    const item = await GiftCatalogItem.findById(itemId);
    if (!item || !item.isActive || !["LOW", "MID"].includes(item.tier)) {
      return res.status(404).json({ success: false, message: "Gift not available" });
    }

    return res.status(200).json({ success: true, item: serializeCatalogItem(item) });
  } catch (error) {
    console.error("❌ [getGiftCatalogItem] error:", error.message);
    return res.status(500).json({ success: false, message: "Failed to load gift" });
  }
};

export { serializeCatalogItem };
