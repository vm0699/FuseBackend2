import UserProfile from "../models/UserProfile.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { sendOTP, verifyOTP } from "../middleware/otpService.js";

dotenv.config();

/**
 * STEP 1 — VERIFY PHONE NUMBER (SEND OTP)
 */
export const verifyPhoneNumber = async (req, res) => {
  const { phoneNumber } = req.body;

  console.log("📞 [verifyPhoneNumber] Incoming phone:", phoneNumber);

  if (!phoneNumber) {
    console.log("❌ [verifyPhoneNumber] Missing phone number");
    return res.status(400).json({
      success: false,
      message: "Phone number is required.",
    });
  }

  try {
    // 🔹 Normalize phone number
    let formattedPhone = phoneNumber.trim();
    if (!formattedPhone.startsWith("+")) {
      formattedPhone = `+${formattedPhone}`;
    }

    console.log("📞 [verifyPhoneNumber] Normalized phone:", formattedPhone);

    const user = await UserProfile.findOne({ phoneNumber: formattedPhone });

    if (user) {
      console.log("👤 [verifyPhoneNumber] Existing user found:", {
        id: user._id.toString(),
        onboardingStage: user.onboardingStage,
        username: user.username,
      });

      const accessToken = jwt.sign(
        {
          id: user._id.toString(),
          phoneNumber: user.phoneNumber,
          username: user.username || "",
        },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      const refreshToken = jwt.sign(
        {
          id: user._id.toString(),
          phoneNumber: user.phoneNumber,
          username: user.username || "",
        },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: "7d" }
      );

      console.log("📤 [verifyPhoneNumber] Sending OTP for EXISTING user…");
      await sendOTP(formattedPhone);
      console.log("✅ [verifyPhoneNumber] OTP sent to existing user");

      console.log("🔑 [verifyPhoneNumber] Tokens issued for EXISTING user");

      return res.status(200).json({
        success: true,
        message: "OTP sent.",
        data: {
          accessToken,
          refreshToken,
          exists: true,
          onboardingStage: user.onboardingStage,
          user: {
            id: user._id.toString(),
            username: user.username || "",
          },
        },
      });
    }

    // 🆕 NEW USER
    console.log("🆕 [verifyPhoneNumber] Creating new user…");

    const newUser = await UserProfile.create({
      phoneNumber: formattedPhone,
      onboardingStage: "PHONE_VERIFIED",
      username: null,
    });

    console.log("🆕 [verifyPhoneNumber] New user created:", {
      id: newUser._id.toString(),
      onboardingStage: newUser.onboardingStage,
    });

    const accessToken = jwt.sign(
      {
        id: newUser._id.toString(),
        phoneNumber: newUser.phoneNumber,
        username: "",
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const refreshToken = jwt.sign(
      {
        id: newUser._id.toString(),
        phoneNumber: newUser.phoneNumber,
        username: "",
      },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    console.log("📤 [verifyPhoneNumber] Sending OTP for NEW user…");
    await sendOTP(formattedPhone);
    console.log("✅ [verifyPhoneNumber] OTP sent");

    return res.status(200).json({
      success: true,
      message: "OTP sent.",
      data: {
        accessToken,
        refreshToken,
        exists: false,
        onboardingStage: "PHONE_VERIFIED",
        user: {
          id: newUser._id.toString(),
          username: "",
        },
      },
    });
  } catch (error) {
    console.error("🔥 [verifyPhoneNumber] ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


/**
 * STEP 2 — VERIFY OTP (FINAL AUTH POINT)
 */
export const verifyCode = async (req, res) => {
  const { phoneNumber, code } = req.body;

  console.log("🔐 [verifyCode] Incoming:", { phoneNumber, code });

  if (!phoneNumber || !code) {
    console.log("❌ [verifyCode] Missing phone or code");
    return res.status(400).json({
      success: false,
      message: "Phone number and OTP code are required.",
    });
  }

  try {
    let formattedPhone = phoneNumber.trim();
    if (!formattedPhone.startsWith("+")) {
      formattedPhone = `+${formattedPhone}`;
    }

    console.log("🔐 [verifyCode] Normalized phone:", formattedPhone);

    const verified = await verifyOTP(formattedPhone, code);
    console.log("🔐 [verifyCode] OTP verified:", verified);

    if (!verified) {
      return res.status(401).json({
        success: false,
        message: "Invalid OTP.",
      });
    }

    const user = await UserProfile.findOne({ phoneNumber: formattedPhone });

    if (!user) {
      console.log("❌ [verifyCode] User not found after OTP");
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    console.log("👤 [verifyCode] User verified:", {
      id: user._id.toString(),
      onboardingStage: user.onboardingStage,
    });

    // ✅ ISSUE TOKENS HERE (CRITICAL FIX)
    const accessToken = jwt.sign(
      {
        id: user._id.toString(),
        phoneNumber: user.phoneNumber,
        username: user.username || "",
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const refreshToken = jwt.sign(
      {
        id: user._id.toString(),
        phoneNumber: user.phoneNumber,
        username: user.username || "",
      },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    console.log("🔑 [verifyCode] Tokens issued");

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully.",
      data: {
        onboardingStage: user.onboardingStage,
        accessToken,
        refreshToken,
        user: {
          id: user._id.toString(),
          username: user.username || "",
        },
      },
    });
  } catch (error) {
    console.error("🔥 [verifyCode] ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};


/**
 * Refresh JWT Token
 */
export const refreshToken = async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ success: false, message: "Refresh token is required." });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const newAccessToken = jwt.sign(
      {
        id: decoded.id,
        phoneNumber: decoded.phoneNumber,
        username: decoded.username || "", // ✅ SAFE
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    return res.status(200).json({
      success: true,
      message: "Token refreshed successfully.",
      data: { accessToken: newAccessToken },
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Refresh token is invalid or expired.",
    });
  }
};
