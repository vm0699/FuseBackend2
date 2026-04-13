import notificationService from "../services/notificationService.js";

export const registerToken = async (req, res) => {
  try {
    const { pushToken, platform, deviceId, provider, metadata } = req.body || {};

    console.log("[notifications] registerToken request", {
      userId: req.user?.id || null,
      platform: platform || null,
      deviceId: deviceId || null,
      provider: provider || "EXPO",
      pushTokenPreview: pushToken ? `${String(pushToken).slice(0, 12)}...` : null,
    });

    if (!pushToken) {
      return res.status(400).json({
        success: false,
        message: "pushToken is required",
      });
    }

    const tokenRecord = await notificationService.registerToken({
      userId: req.user.id,
      pushToken,
      platform,
      deviceId,
      provider,
      metadata,
    });

    console.log("[notifications] registerToken saved", {
      userId: req.user?.id || null,
      tokenId: tokenRecord?._id || null,
      provider: tokenRecord?.provider || null,
      platform: tokenRecord?.platform || null,
      deviceId: tokenRecord?.deviceId || null,
      isActive: tokenRecord?.isActive || false,
    });

    return res.status(200).json({
      success: true,
      token: {
        id: tokenRecord._id,
        provider: tokenRecord.provider,
        platform: tokenRecord.platform,
        deviceId: tokenRecord.deviceId,
        isActive: tokenRecord.isActive,
        lastUsedAt: tokenRecord.lastUsedAt,
      },
    });
  } catch (error) {
    console.error("[notifications] registerToken error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to register device token",
    });
  }
};

export const unregisterToken = async (req, res) => {
  try {
    const { pushToken, deviceId, provider } = req.body || {};

    console.log("[notifications] unregisterToken request", {
      userId: req.user?.id || null,
      deviceId: deviceId || null,
      provider: provider || "EXPO",
      pushTokenPreview: pushToken ? `${String(pushToken).slice(0, 12)}...` : null,
    });

    if (!pushToken && !deviceId) {
      return res.status(400).json({
        success: false,
        message: "pushToken or deviceId is required",
      });
    }

    await notificationService.unregisterToken({
      userId: req.user.id,
      pushToken,
      deviceId,
      provider,
    });

    console.log("[notifications] unregisterToken completed", {
      userId: req.user?.id || null,
      deviceId: deviceId || null,
      provider: provider || "EXPO",
    });

    return res.status(200).json({
      success: true,
      message: "Device token unregistered",
    });
  } catch (error) {
    console.error("[notifications] unregisterToken error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to unregister device token",
    });
  }
};
