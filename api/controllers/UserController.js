import UserProfile from '../models/UserProfile.js';
import Like from '../models/Like.js';
import Chat from '../models/ChatModel.js';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3Client } from '@aws-sdk/client-s3';

const extractS3KeyFromUrl = (fileUrl) => {
  if (typeof fileUrl !== 'string' || fileUrl.trim().length === 0) {
    return null;
  }

  try {
    const parsed = new URL(fileUrl);
    const pathname = parsed.pathname.replace(/^\/+/, '');

    if (!pathname) {
      return null;
    }

    if (process.env.AWS_S3_BUCKET) {
      const regionalHost = `${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`;
      const globalHost = `${process.env.AWS_S3_BUCKET}.s3.amazonaws.com`;

      if (parsed.hostname === regionalHost || parsed.hostname === globalHost) {
        return decodeURIComponent(pathname);
      }

      if (
        parsed.hostname.includes('amazonaws.com') &&
        pathname.startsWith(`${process.env.AWS_S3_BUCKET}/`)
      ) {
        return decodeURIComponent(pathname.slice(process.env.AWS_S3_BUCKET.length + 1));
      }
    }
  } catch {
    return null;
  }

  return null;
};

// ✅ Get User Profile
export const getProfile = async (req, res) => {
  try {
    console.log("🧭 [getProfile] Incoming request");
    console.log("🧭 [getProfile] req.user from authMiddleware:", req.user);

    const userId = req.user?.id;

    if (!userId) {
      console.log("❌ [getProfile] Missing req.user.id");
      return res.status(401).json({
        success: false,
        message: "Unauthorized: missing user id",
      });
    }

    console.log("🔎 [getProfile] Fetching user by ID:", userId);

    const user = await UserProfile.findById(userId);

    if (!user) {
      console.log("❌ [getProfile] User not found in DB for ID:", userId);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.log("✅ [getProfile] User found:", {
      id: user._id.toString(),
      phoneNumber: user.phoneNumber,
      username: user.username,
      onboardingStage: user.onboardingStage,
    });

    res.status(200).json({
      success: true,
      data: {
        // 🔹 2.1 CORE — REQUIRED FOR AUTHGATE
        onboardingStage: user.onboardingStage,

        // profile fields
        phoneNumber: user.phoneNumber,
        name: user.name,
        username: user.username,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        height: user.height,
        interests: user.interests,
        values: user.values,
        prompts: user.prompts,
        photos: user.photos,
        location: user.location,
      },
    });

    console.log("📤 [getProfile] Response sent successfully");
  } catch (error) {
    console.error("🔥 [getProfile] Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ✅ Update User Location
export const updateLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      console.error('❌ Invalid location data received:', req.body);
      return res.status(400).json({
        success: false,
        message: 'Invalid location data',
      });
    }

    console.log(
      '📌 Updating location for user:',
      req.user.id,
      'to:',
      { latitude, longitude }
    );

    const user = await UserProfile.findById(req.user.id);

    if (!user) {
      console.log('❌ User not found for location update:', req.user.id);
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    user.location = { latitude, longitude };
    await user.save();

    console.log('✅ Location updated successfully:', user.location);

    res.status(200).json({
      success: true,
      message: 'Location updated successfully',
      location: user.location,
    });
  } catch (error) {
    console.error('❌ Error updating location:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update location',
    });
  }
};

// ✅ Delete Account and Related Data
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

export const deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    console.log('🗑️ Deleting user:', userId);

    // 1. Delete user profile
    const user = await UserProfile.findByIdAndDelete(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // 2. Delete all likes related to this user
    await Like.deleteMany({
      $or: [{ likerId: userId }, { likedUserId: userId }],
    });

    // 3. Delete all chats involving this user
    await Chat.deleteMany({
      $or: [{ senderId: userId }, { receiverId: userId }],
    });

    // 4. Clean references from other user profiles
    await UserProfile.updateMany(
      {},
      {
        $pull: {
          swipedRight: userId,
          swipedLeft: userId,
          matches: userId,
          swipedUserIds: userId,
        },
      }
    );

    // 5. Delete user's uploaded photos from S3
    if (user.photos && user.photos.length > 0) {
      const deletePromises = user.photos.map((url) => {
        const key = extractS3KeyFromUrl(url);
        if (!key) {
          return Promise.resolve();
        }

        const command = new DeleteObjectCommand({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: key,
        });
        return s3.send(command);
      });

      await Promise.all(deletePromises);
      console.log('✅ Deleted photos from S3');
    }

    res.status(200).json({
      success: true,
      message: 'Account deleted successfully',
    });
  } catch (error) {
    console.error('❌ Error deleting account:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during account deletion',
    });
  }
};
