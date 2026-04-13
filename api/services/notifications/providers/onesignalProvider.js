export const oneSignalProvider = {
  provider: "ONESIGNAL",

  async send(tokens) {
    console.warn(
      `[notifications] OneSignal provider is not wired yet. Skipping ${tokens.length} token(s).`
    );

    return {
      provider: "ONESIGNAL",
      sentCount: 0,
      invalidTokens: [],
      tickets: [],
    };
  },
};
