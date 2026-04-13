import DeviceToken from "../models/DeviceToken.js";
import {
  buildNotificationPayload,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_TYPES,
} from "./notifications/notificationTypes.js";
import { expoProvider } from "./notifications/providers/expoProvider.js";
import { fcmProvider } from "./notifications/providers/fcmProvider.js";
import { oneSignalProvider } from "./notifications/providers/onesignalProvider.js";

const DEFAULT_PROVIDER = (process.env.NOTIFICATION_PROVIDER || "EXPO").toUpperCase();

const providers = {
  EXPO: expoProvider,
  FCM: fcmProvider,
  ONESIGNAL: oneSignalProvider,
};

const normalizePlatform = (platform = "") => {
  const value = String(platform || "").trim().toLowerCase();
  if (["ios", "android", "web"].includes(value)) return value;
  return "unknown";
};

const normalizeProvider = (provider = "") => {
  const value = String(provider || DEFAULT_PROVIDER).trim().toUpperCase();
  if (providers[value]) return value;
  return DEFAULT_PROVIDER;
};

const getProviderHandler = (provider = DEFAULT_PROVIDER) => {
  const normalizedProvider = normalizeProvider(provider);
  return providers[normalizedProvider] || providers[DEFAULT_PROVIDER];
};

const buildTokenQuery = ({ pushToken, deviceId, provider }) => {
  const conditions = [];

  if (pushToken) {
    conditions.push({
      pushToken: String(pushToken).trim(),
      provider: normalizeProvider(provider),
    });
  }

  if (deviceId) {
    conditions.push({
      deviceId: String(deviceId).trim(),
      provider: normalizeProvider(provider),
    });
  }

  if (conditions.length === 1) {
    return conditions[0];
  }

  return conditions.length > 1 ? { $or: conditions } : null;
};

const normalizeTokenInput = (tokens = []) =>
  tokens
    .map((tokenEntry) => {
      if (!tokenEntry) return null;

      if (typeof tokenEntry === "string") {
        return {
          pushToken: tokenEntry,
          provider: DEFAULT_PROVIDER,
        };
      }

      return tokenEntry;
    })
    .filter(Boolean);

export const notificationService = {
  currentProvider: DEFAULT_PROVIDER,
  providers,
  NOTIFICATION_TYPES,
  NOTIFICATION_DEFAULTS,
  buildNotificationPayload,

  async registerToken({
    userId,
    pushToken,
    platform,
    deviceId,
    provider,
    metadata = {},
  }) {
    if (!userId || !pushToken) {
      throw new Error("userId and pushToken are required");
    }

    const normalizedProvider = normalizeProvider(provider);
    const normalizedPushToken = String(pushToken).trim();
    const normalizedDeviceId = String(deviceId || "").trim();

    console.log("[notifications] registerToken service", {
      userId: String(userId),
      provider: normalizedProvider,
      platform: normalizePlatform(platform),
      deviceId: normalizedDeviceId || null,
      pushTokenPreview: `${normalizedPushToken.slice(0, 12)}...`,
    });

    const existing = await DeviceToken.findOne(
      buildTokenQuery({
        pushToken: normalizedPushToken,
        deviceId: normalizedDeviceId,
        provider: normalizedProvider,
      })
    );

    if (existing) {
      console.log("[notifications] updating existing device token", {
        tokenId: existing._id?.toString?.() || existing._id,
        previousUserId: existing.userId?.toString?.() || existing.userId,
      });
      existing.userId = userId;
      existing.pushToken = normalizedPushToken;
      existing.provider = normalizedProvider;
      existing.platform = normalizePlatform(platform);
      existing.deviceId = normalizedDeviceId;
      existing.isActive = true;
      existing.lastUsedAt = new Date();
      existing.invalidatedAt = null;
      existing.invalidReason = "";
      existing.metadata = {
        ...(existing.metadata || {}),
        ...(metadata || {}),
      };
      await existing.save();
      return existing;
    }

    console.log("[notifications] creating new device token record", {
      userId: String(userId),
      provider: normalizedProvider,
      deviceId: normalizedDeviceId || null,
    });

    return DeviceToken.create({
      userId,
      pushToken: normalizedPushToken,
      provider: normalizedProvider,
      platform: normalizePlatform(platform),
      deviceId: normalizedDeviceId,
      isActive: true,
      lastUsedAt: new Date(),
      metadata,
    });
  },

  async unregisterToken({ userId, pushToken, deviceId, provider }) {
    if (!userId) {
      throw new Error("userId is required");
    }

    const query = buildTokenQuery({ pushToken, deviceId, provider });
    if (!query) {
      throw new Error("pushToken or deviceId is required");
    }

    return DeviceToken.updateMany(
      {
        userId,
        ...query,
      },
      {
        $set: {
          isActive: false,
          lastUsedAt: new Date(),
          invalidatedAt: new Date(),
          invalidReason: "user_unregistered",
        },
      }
    );
  },

  async deactivateInvalidToken(pushToken, reason = "invalid_token", provider = DEFAULT_PROVIDER) {
    if (!pushToken) return;

    console.log("[notifications] deactivating invalid token", {
      provider: normalizeProvider(provider),
      reason,
      pushTokenPreview: `${String(pushToken).trim().slice(0, 12)}...`,
    });

    await DeviceToken.updateMany(
      {
        pushToken: String(pushToken).trim(),
        provider: normalizeProvider(provider),
      },
      {
        $set: {
          isActive: false,
          invalidatedAt: new Date(),
          invalidReason: reason,
          lastUsedAt: new Date(),
        },
      }
    );
  },

  async sendToTokens(tokens = [], notificationPayload) {
    const normalizedTokens = normalizeTokenInput(tokens);
    if (!normalizedTokens.length) {
      console.log("[notifications] sendToTokens skipped: no tokens");
      return { sentCount: 0, invalidated: 0, results: [] };
    }

    const payload = buildNotificationPayload(notificationPayload);
    console.log("[notifications] sendToTokens", {
      type: payload?.data?.type || payload?.type || null,
      tokenCount: normalizedTokens.length,
      providers: Array.from(
        new Set(normalizedTokens.map((tokenEntry) => normalizeProvider(tokenEntry.provider)))
      ),
      data: payload?.data || null,
    });
    const providerBuckets = normalizedTokens.reduce((acc, tokenEntry) => {
      const provider = normalizeProvider(tokenEntry.provider);
      if (!acc[provider]) {
        acc[provider] = [];
      }
      acc[provider].push(tokenEntry);
      return acc;
    }, {});

    const results = [];
    for (const [provider, providerTokens] of Object.entries(providerBuckets)) {
      const providerHandler = getProviderHandler(provider);
      console.log("[notifications] sending notification bucket", {
        provider,
        tokenCount: providerTokens.length,
        type: payload?.data?.type || null,
      });
      const result = await providerHandler.send(providerTokens, payload);
      console.log("[notifications] provider send result", {
        provider,
        sentCount: result?.sentCount || 0,
        invalidTokens: (result?.invalidTokens || []).length,
        tickets: (result?.tickets || []).length,
      });
      results.push(result);

      for (const invalidToken of result.invalidTokens || []) {
        await this.deactivateInvalidToken(
          invalidToken.pushToken,
          invalidToken.reason,
          invalidToken.provider || provider
        );
      }
    }

    return {
      sentCount: results.reduce((sum, result) => sum + (result.sentCount || 0), 0),
      invalidated: results.reduce(
        (sum, result) => sum + ((result.invalidTokens || []).length || 0),
        0
      ),
      results,
    };
  },

  async sendToUser(userId, notificationPayload) {
    if (!userId) return { sentCount: 0, invalidated: 0, results: [] };

    const activeTokens = await DeviceToken.find({
      userId,
      isActive: true,
    }).lean();

    console.log("[notifications] sendToUser lookup", {
      userId: String(userId),
      type: notificationPayload?.data?.type || notificationPayload?.type || null,
      activeTokenCount: activeTokens.length,
      tokens: activeTokens.map((token) => ({
        id: token?._id?.toString?.() || token?._id || null,
        provider: token?.provider || null,
        platform: token?.platform || null,
        deviceId: token?.deviceId || null,
        pushTokenPreview: token?.pushToken
          ? `${String(token.pushToken).slice(0, 12)}...`
          : null,
      })),
    });

    if (!activeTokens.length) {
      return { sentCount: 0, invalidated: 0, results: [] };
    }

    return this.sendToTokens(activeTokens, notificationPayload);
  },

  async sendToUsers(userIds = [], notificationPayload) {
    const uniqueUserIds = Array.from(
      new Set((userIds || []).map((userId) => String(userId || "")).filter(Boolean))
    );

    if (!uniqueUserIds.length) {
      return { sentCount: 0, invalidated: 0, results: [] };
    }

    const activeTokens = await DeviceToken.find({
      userId: { $in: uniqueUserIds },
      isActive: true,
    }).lean();

    return this.sendToTokens(activeTokens, notificationPayload);
  },

  async sendVideoCallInvite(userId, data = {}) {
    return this.sendToUser(
      userId,
      buildNotificationPayload({
        type: NOTIFICATION_TYPES.VIDEO_CALL_INVITE,
        data,
      })
    );
  },

  async sendMissedVideoCall(userId, data = {}) {
    return this.sendToUser(
      userId,
      buildNotificationPayload({
        type: NOTIFICATION_TYPES.VIDEO_CALL_MISSED,
        data,
      })
    );
  },

  async sendAccountAlert(userId, data = {}, overrides = {}) {
    return this.sendToUser(
      userId,
      buildNotificationPayload({
        type: NOTIFICATION_TYPES.ACCOUNT_ALERT,
        title: overrides.title,
        body: overrides.body,
        data,
      })
    );
  },
};

export default notificationService;
