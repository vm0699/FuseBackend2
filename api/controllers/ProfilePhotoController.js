import path from "path";
import UserProfile from "../models/UserProfile.js";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const s3ClientConfig = {
  region: process.env.AWS_REGION,
};

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  s3ClientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const s3 = new S3Client(s3ClientConfig);
const s3Bucket = process.env.AWS_S3_BUCKET;
const s3PublicBaseUrl = process.env.AWS_S3_PUBLIC_BASE_URL;

const ensureS3UploadConfig = () => {
  const missing = [];

  if (!process.env.AWS_REGION) missing.push("AWS_REGION");
  if (!s3Bucket) missing.push("AWS_S3_BUCKET");

  if (missing.length > 0) {
    throw new Error(`Missing required S3 configuration: ${missing.join(", ")}`);
  }
};

const getUploadExtension = (file) => {
  const originalExtension = path.extname(file?.originalname || "").toLowerCase();
  if (originalExtension) return originalExtension;

  const byMimeType = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
  };

  return byMimeType[file?.mimetype] || "";
};

const buildS3ObjectKey = (file, userId) => {
  const extension = getUploadExtension(file);
  const rawName = path.basename(file?.originalname || "upload", extension);
  const safeName =
    rawName.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/-+/g, "-").slice(0, 60) ||
    "upload";

  return `profile-photos/${userId}/${Date.now()}-${safeName}${extension}`;
};

const encodeS3Key = (key) => key.split("/").map(encodeURIComponent).join("/");

const buildS3PublicUrl = (key) => {
  const encodedKey = encodeS3Key(key);

  if (s3PublicBaseUrl) {
    return `${s3PublicBaseUrl.replace(/\/+$/, "")}/${encodedKey}`;
  }

  return `https://${s3Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${encodedKey}`;
};

const uploadPhotoToS3 = async (file, userId) => {
  ensureS3UploadConfig();

  if (!file?.buffer) {
    throw new Error("Uploaded file buffer missing.");
  }

  const key = buildS3ObjectKey(file, userId);

  await s3.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );

  return {
    key,
    url: buildS3PublicUrl(key),
  };
};

const extractS3KeyFromUrl = (fileUrl) => {
  if (typeof fileUrl !== "string" || fileUrl.trim().length === 0) {
    return null;
  }

  if (s3PublicBaseUrl) {
    const normalizedBase = s3PublicBaseUrl.replace(/\/+$/, "");
    if (fileUrl.startsWith(`${normalizedBase}/`)) {
      return decodeURIComponent(
        fileUrl.slice(normalizedBase.length + 1).split(/[?#]/)[0]
      );
    }
  }

  try {
    const parsed = new URL(fileUrl);
    const pathname = parsed.pathname.replace(/^\/+/, "");

    if (!pathname) {
      return null;
    }

    if (s3Bucket && parsed.hostname === `${s3Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com`) {
      return decodeURIComponent(pathname);
    }

    if (s3Bucket && parsed.hostname === `${s3Bucket}.s3.amazonaws.com`) {
      return decodeURIComponent(pathname);
    }

    if (
      s3Bucket &&
      parsed.hostname.includes("amazonaws.com") &&
      pathname.startsWith(`${s3Bucket}/`)
    ) {
      return decodeURIComponent(pathname.slice(s3Bucket.length + 1));
    }
  } catch {
    return null;
  }

  return null;
};

const deleteStoredPhotoIfPresent = async (fileUrl) => {
  const s3Key = extractS3KeyFromUrl(fileUrl);
  if (!s3Key) return;

  ensureS3UploadConfig();
  await s3.send(
    new DeleteObjectCommand({
      Bucket: s3Bucket,
      Key: s3Key,
    })
  );
};

const deleteStoredPhotos = async (photoUrls) => {
  const results = await Promise.allSettled(
    (photoUrls || []).map((photoUrl) => deleteStoredPhotoIfPresent(photoUrl))
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("[uploadPhotos] Failed to delete old photo:", photoUrls[index], result.reason);
    }
  });
};

export const uploadPhotos = async (req, res) => {
  let uploadedFileUrls = [];
  let uploadPersisted = false;

  try {
    console.log("[uploadPhotos] Incoming body:", req.body);
    console.log(
      "[uploadPhotos] Incoming files:",
      Array.isArray(req.files)
        ? req.files.map((file) => ({
            fieldname: file.fieldname,
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            hasBuffer: Boolean(file.buffer),
          }))
        : req.files
    );

    const userId = req.user?.id;
    const phoneFromToken = req.user?.phoneNumber;
    const replaceIndex =
      req.body.replaceIndex !== undefined && req.body.replaceIndex !== null
        ? Number(req.body.replaceIndex)
        : null;
    const replaceAll =
      req.body.replaceAll === true || req.body.replaceAll === "true";
    const requestedOnboardingStage = req.body.onboardingStage;

    if (!userId || !phoneFromToken) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: missing user in token",
      });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No files were uploaded.",
      });
    }

    const user = await UserProfile.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    console.log("[uploadPhotos] User before update:", {
      userId: user._id?.toString?.() || userId,
      currentPhotos: user.photos || [],
      replaceIndex,
      replaceAll,
      requestedOnboardingStage,
    });

    if (!Array.isArray(user.photos)) {
      user.photos = [];
    }

    const uploadedFiles = await Promise.all(
      req.files.map((file) => uploadPhotoToS3(file, userId))
    );
    const fileUrls = uploadedFiles.map((file) => file.url);
    uploadedFileUrls = fileUrls;

    const allowedOnboardingStages = [
      "PHONE_VERIFIED",
      "INTRO_DONE",
      "PROFILE_SETUP_DONE",
      "LOCATION_DONE",
      "DETAILS_DONE",
      "PROMPTS_DONE",
      "PHOTOS_DONE",
      "COMPLETE",
    ];

    const pendingFileDeletes = [];

    if (replaceAll) {
      pendingFileDeletes.push(...(user.photos || []));
      user.photos = fileUrls;
    } else if (
      replaceIndex !== null &&
      Number.isInteger(replaceIndex) &&
      replaceIndex >= 0
    ) {
      const existingPhoto = user.photos?.[replaceIndex];
      if (existingPhoto && existingPhoto !== fileUrls[0]) {
        pendingFileDeletes.push(existingPhoto);
      }
      user.photos[replaceIndex] = fileUrls[0];
    } else {
      user.photos.push(...fileUrls);
    }

    if (
      typeof requestedOnboardingStage === "string" &&
      allowedOnboardingStages.includes(requestedOnboardingStage)
    ) {
      user.onboardingStage = requestedOnboardingStage;
    }

    console.log("[uploadPhotos] User after in-memory update:", {
      nextPhotos: user.photos,
      pendingFileDeletes,
      uploadedFileUrls,
    });

    await user.save();
    uploadPersisted = true;
    await deleteStoredPhotos(pendingFileDeletes);

    console.log("[uploadPhotos] User after save:", {
      savedPhotos: user.photos,
      savedOnboardingStage: user.onboardingStage,
    });

    return res.status(200).json({
      success: true,
      message: "Photos uploaded successfully!",
      data: {
        photos: user.photos,
        uploadedUrls: fileUrls,
        onboardingStage: user.onboardingStage,
      },
    });
  } catch (error) {
    console.error("[uploadPhotos] ERROR:", error);

    if (!uploadPersisted && uploadedFileUrls.length > 0) {
      await deleteStoredPhotos(uploadedFileUrls);
      console.log("[uploadPhotos] Rolled back uploaded files:", uploadedFileUrls);
    }

    return res.status(500).json({
      success: false,
      message: "An error occurred while uploading photos.",
    });
  }
};
