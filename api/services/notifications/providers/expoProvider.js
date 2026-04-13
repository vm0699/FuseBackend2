const EXPO_PROVIDER = "EXPO";

let expoClientPromise = null;

const getExpoClient = async () => {
  if (!expoClientPromise) {
    expoClientPromise = import("expo-server-sdk").then(({ Expo }) => {
      return new Expo({
        accessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
        useFcmV1: true,
      });
    });
  }

  return expoClientPromise;
};

const isPermanentExpoError = (errorCode = "") =>
  ["DeviceNotRegistered", "MismatchSenderId", "InvalidCredentials"].includes(
    errorCode
  );

export const expoProvider = {
  provider: EXPO_PROVIDER,

  async send(tokens, payload) {
    const expo = await getExpoClient();
    const messages = [];
    const invalidTokens = [];

    console.log("[notifications] expoProvider.send", {
      tokenCount: Array.isArray(tokens) ? tokens.length : 0,
      type: payload?.data?.type || null,
      title: payload?.title || null,
    });

    for (const tokenEntry of tokens) {
      const pushToken = tokenEntry?.pushToken || "";

      if (!pushToken || !expo.constructor.isExpoPushToken(pushToken)) {
        console.log("[notifications] invalid Expo token detected before send", {
          pushTokenPreview: pushToken ? `${String(pushToken).slice(0, 12)}...` : null,
        });
        invalidTokens.push({
          pushToken,
          provider: EXPO_PROVIDER,
          reason: "invalid_expo_push_token",
        });
        continue;
      }

      messages.push({
        to: pushToken,
        sound: "default",
        title: payload.title,
        body: payload.body,
        data: payload.data,
      });
    }

    console.log("[notifications] expoProvider prepared messages", {
      count: messages.length,
      targets: messages.map((message) => `${String(message.to).slice(0, 12)}...`),
    });

    const tickets = [];
    const chunks = expo.chunkPushNotifications(messages);

    for (const chunk of chunks) {
      try {
        console.log("[notifications] expoProvider sending chunk", {
          size: chunk.length,
          targets: chunk.map((message) => `${String(message.to).slice(0, 12)}...`),
        });
        const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
        console.log("[notifications] expoProvider chunk tickets", chunkTickets);
        tickets.push(...chunkTickets);
      } catch (error) {
        console.error("[notifications] Expo send chunk failed:", error.message);
      }
    }

    tickets.forEach((ticket, index) => {
      if (ticket?.status !== "error") return;

      const sourceToken = messages[index]?.to;
      const errorCode = ticket?.details?.error || "expo_send_error";

      if (isPermanentExpoError(errorCode)) {
        invalidTokens.push({
          pushToken: sourceToken,
          provider: EXPO_PROVIDER,
          reason: errorCode,
        });
      }
    });

    console.log("[notifications] expoProvider send complete", {
      sentCount: messages.length,
      invalidTokenCount: invalidTokens.length,
    });

    return {
      provider: EXPO_PROVIDER,
      sentCount: messages.length,
      invalidTokens,
      tickets,
    };
  },
};
