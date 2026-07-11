import client from "../config/twilio.js";

const normalizePairKey = (firstUserId, secondUserId) =>
  [firstUserId.toString(), secondUserId.toString()].sort().join("|");

const getStoredChannelSid = (chat) =>
  chat?.twilioChannelSid || chat?.twilioChatChannelSid || null;

const getChannelFriendlyName = (firstUserId, secondUserId) =>
  `${firstUserId}-${secondUserId}`;

const shouldIgnoreMemberError = (error) => {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("already exists") ||
    message.includes("already a member") ||
    message.includes("member already exists") ||
    error?.status === 409
  );
};

const ensureChannelMembers = async (service, channelSid, participantIds) => {
  const uniqueParticipantIds = [...new Set(
    participantIds
      .map((participantId) => participantId?.toString?.())
      .filter(Boolean)
  )];

  let synced = true;

  for (const participantId of uniqueParticipantIds) {
    try {
      await service.channels(channelSid).members.create({
        identity: participantId,
      });
    } catch (error) {
      if (shouldIgnoreMemberError(error)) {
        continue;
      }

      synced = false;
      console.log("Twilio member sync skipped:", error?.message || error);
    }
  }

  return synced;
};

export const ensureChatTwilioChannel = async ({
  chat,
  userAId,
  userBId,
}) => {
  if (!chat) return null;

  const serviceSid = process.env.TWILIO_CHAT_SERVICE_SID;
  let channelSid = getStoredChannelSid(chat);
  let shouldSaveChat = false;

  if (!serviceSid) {
    return channelSid;
  }

  const service = client.chat.v2.services(serviceSid);

  if (!channelSid) {
    const pairKey = chat.pairKey || normalizePairKey(userAId, userBId);
    const createdChannel = await service.channels.create({
      friendlyName: getChannelFriendlyName(userAId, userBId),
      uniqueName: `chat-${pairKey}`,
      // 🔒 Chat tokens carry a service-wide grant (Twilio's ChatGrant can't be
      // scoped to one channel), so channel-level access must be private —
      // otherwise any user with a valid token could join by SID without
      // being an added member.
      type: "private",
    });

    channelSid = createdChannel.sid;
    chat.pairKey = pairKey;
    chat.twilioChannelSid = channelSid;
    chat.twilioChatChannelSid = chat.twilioChatChannelSid || channelSid;
    shouldSaveChat = true;
  }

  if (channelSid && !chat.twilioMembersInitialized) {
    const membersSynced = await ensureChannelMembers(service, channelSid, [
      userAId,
      userBId,
    ]);

    if (membersSynced) {
      chat.twilioMembersInitialized = true;
      shouldSaveChat = true;
    }
  }

  if (shouldSaveChat) {
    await chat.save();
  }

  return channelSid;
};
