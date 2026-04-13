import jwt from "jsonwebtoken";
import UserProfile from "../models/UserProfile.js";

const authMiddleware = async (req, res, next) => {
  console.log("🔑 [DEBUG] authMiddleware hit", req.headers);
  try {
    const token = req.headers.authorization?.split(" ")[1];
    console.log("🔹 Received Authorization Header:", req.headers.authorization);

    if (!token) {
      console.log("❌ Auth Middleware: No token provided.");
      return res.status(401).json({ success: false, message: "Unauthorized: No token" });
    }

    // ✅ Verify JWT and Extract Data
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      console.error("❌ JWT Error:", error.message);
      return res.status(401).json({ success: false, message: "Unauthorized: Invalid or expired token" });
    }

    console.log("🔹 Decoded JWT:", decoded);

    /**
     * 🔹 2.1 FIX:
     * username is OPTIONAL during onboarding
     * Only id + phoneNumber are mandatory
     */
    if (!decoded.id || typeof decoded.id !== "string" || !decoded.phoneNumber) {
      console.warn("⚠️ Token missing required fields. Decoded:", decoded);
      return res.status(400).json({
        success: false,
        message: "Invalid token data",
      });
    }

    // ✅ Convert `id` to String (safe)
    const userId = String(decoded.id).trim();

    console.log(`🔹 Fetching user from DB: ID = ${userId}`);

    // ✅ Fetch User from Database
    const user = await UserProfile.findById(userId);

    if (!user) {
      console.warn("⚠️ Auth Middleware: User not found in database.");
      return res.status(404).json({ success: false, message: "User not found" });
    }

    /**
     * 🔹 2.1 FIX:
     * Provide SAFE DEFAULTS for onboarding users
     */
    req.user = {
      id: user._id.toString(),
      phoneNumber: user.phoneNumber,
      username: user.username || "", // ✅ onboarding-safe
      name: user.name || "",
      gender: user.gender || "",
      interests: user.interests || [],
    };

    console.log("✅ Authenticated user:", req.user);
    console.log("🔑 [DEBUG] Passing to next middleware or route");
    next();
  } catch (error) {
    console.error("❌ Auth Middleware Error:", error);
    // Include the actual error code in the response to aid debugging
    return res.status(500).json({
      success: false,
      message: "Server error during authentication",
      ...(process.env.NODE_ENV !== "production" && {
        detail: error.message,
        code: error.code,
      }),
    });
  }
};

export default authMiddleware;
