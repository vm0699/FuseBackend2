import UserProfile from "../models/UserProfile.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { sendOTP, verifyOTP } from "../middleware/otpService.js";
import {
  sendEmailOTP as sendEmailOTPCode,
  verifyEmailOTP as verifyEmailOTPCode,
} from "../middleware/emailOtpService.js";

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

      // 🔒 SECURITY: tokens must NOT be issued here — this step only sends the
      // OTP and has not verified anything yet. Tokens are issued exclusively
      // in verifyCode(), after Twilio confirms the code is correct.
      console.log("📤 [verifyPhoneNumber] Sending OTP for EXISTING user…");
      await sendOTP(formattedPhone);
      console.log("✅ [verifyPhoneNumber] OTP sent to existing user");

      return res.status(200).json({
        success: true,
        message: "OTP sent.",
        data: {
          exists: true,
          onboardingStage: user.onboardingStage,
          user: {
            id: user._id.toString(),
            username: user.username || "",
          },
        },
      });
    }

    // 🆕 NO ACCOUNT FOR THIS NUMBER YET
    // 🔒 SECURITY: do NOT create the UserProfile row here — this step has not
    // verified anything yet. Creating it here let anyone flood the DB with
    // unverified accounts and squat a phone number (unique index) before its
    // real owner ever verifies. The row is now created in verifyCode(), and
    // only after Twilio confirms the code is correct.
    console.log("📤 [verifyPhoneNumber] Sending OTP for new number…");
    await sendOTP(formattedPhone);
    console.log("✅ [verifyPhoneNumber] OTP sent");

    return res.status(200).json({
      success: true,
      message: "OTP sent.",
      data: {
        exists: false,
        onboardingStage: "PHONE_VERIFIED",
        user: null,
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

  console.log("🔐 [verifyCode] Incoming:", { phoneNumber, code: code ? "[REDACTED]" : code });

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

    // 🔒 Account is created here — the first time this number is confirmed to
    // be verified — never before. Atomic upsert avoids a duplicate-key race
    // if this endpoint is somehow hit twice concurrently for the same number.
    const user = await UserProfile.findOneAndUpdate(
      { phoneNumber: formattedPhone },
      {
        $setOnInsert: {
          phoneNumber: formattedPhone,
          onboardingStage: "PHONE_VERIFIED",
          username: null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

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
 * EMAIL LOGIN — STEP 1 — SEND OTP
 * Email must already be linked to an existing phone-verified account
 * (added via Settings). This is a login shortcut, not a signup path.
 */
export const sendEmailOTPHandler = async (req, res) => {
  const { email } = req.body;

  console.log("📧 [sendEmailOTP] Incoming email:", email);

  if (!email || typeof email !== "string") {
    return res.status(400).json({
      success: false,
      message: "Email is required.",
    });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await UserProfile.findOne({ email: normalizedEmail });

    if (!user) {
      console.log("❌ [sendEmailOTP] No account linked to this email");
      return res.status(404).json({
        success: false,
        message:
          "No account found with this email. Please continue with your phone number instead.",
      });
    }

    await sendEmailOTPCode(normalizedEmail);
    console.log("✅ [sendEmailOTP] OTP emailed to:", normalizedEmail);

    return res.status(200).json({
      success: true,
      message: "OTP sent.",
    });
  } catch (error) {
    console.error("🔥 [sendEmailOTP] ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to send email OTP.",
    });
  }
};

/**
 * EMAIL LOGIN — STEP 2 — VERIFY OTP (FINAL AUTH POINT)
 */
export const verifyEmailOTPHandler = async (req, res) => {
  const { email, code } = req.body;

  console.log("🔐 [verifyEmailOTP] Incoming:", { email, code: code ? "[REDACTED]" : code });

  if (!email || !code) {
    return res.status(400).json({
      success: false,
      message: "Email and OTP code are required.",
    });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();

    const verified = await verifyEmailOTPCode(normalizedEmail, code);
    console.log("🔐 [verifyEmailOTP] OTP verified:", verified);

    if (!verified) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired OTP.",
      });
    }

    const user = await UserProfile.findOne({ email: normalizedEmail });

    if (!user) {
      console.log("❌ [verifyEmailOTP] User not found after OTP");
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

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

    console.log("🔑 [verifyEmailOTP] Tokens issued");

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
    console.error("🔥 [verifyEmailOTP] ERROR:", error);
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
