const ACTIVE_CHAT_STATUSES = ["pending", "accepted"];

const hasTarget = (items = [], targetId) =>
  Array.isArray(items) &&
  items.some((item) => item?.toString?.() === targetId?.toString?.());

export const deriveSwipeState = ({
  actorProfile,
  targetUserId,
  outgoingLike,
  reciprocalLike,
  activeChat,
}) => {
  const actorMatched = hasTarget(actorProfile?.matches, targetUserId);
  const actorLiked = hasTarget(actorProfile?.swipedRight, targetUserId);
  const actorDisliked = hasTarget(actorProfile?.swipedLeft, targetUserId);

  const outgoingStatus = outgoingLike?.status || null;
  const reciprocalStatus = reciprocalLike?.status || null;
  const chatStatus = activeChat?.status || null;

  if (
    actorMatched ||
    outgoingStatus === "matched" ||
    reciprocalStatus === "matched" ||
    (chatStatus && ACTIVE_CHAT_STATUSES.includes(chatStatus))
  ) {
    return "matched";
  }

  if (actorDisliked || outgoingStatus === "closed") {
    return "disliked";
  }

  if (outgoingStatus === "pending" || actorLiked) {
    return "liked_pending";
  }

  return "neutral";
};

export const getSwipeTransition = ({ currentState, action }) => {
  if (action === "like") {
    if (currentState === "matched") {
      return "noop_matched";
    }
    if (currentState === "liked_pending") {
      return "noop_pending_like";
    }
    return "record_like";
  }

  if (currentState === "matched") {
    return "noop_matched";
  }

  if (currentState === "disliked") {
    return "noop_disliked";
  }

  return "record_dislike";
};
