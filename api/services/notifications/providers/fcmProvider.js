export const fcmProvider = {
  provider: "FCM",

  async send(tokens) {
    console.warn(
      `[notifications] FCM provider is not wired yet. Skipping ${tokens.length} token(s).`
    );

    return {
      provider: "FCM",
      sentCount: 0,
      invalidTokens: [],
      tickets: [],
    };
  },
};
