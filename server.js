// server.js

import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import http from 'http';
import { Server } from 'socket.io';
import connectDB from './api/config/db.js';
import profileRoutes from './api/routes/ProfileRoutes.js';
import authRoutes from './api/routes/auth.js';
import userRoutes from './api/routes/User.js';
import chatRoutes from './api/routes/ChatRoutes.js';
import videoRoutes from './api/routes/VideoRoutes.js';
import likeRoutes from './api/routes/likeRoutes.js';
import notificationRoutes from './api/routes/NotificationRoutes.js';
import twilio from 'twilio';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import agoraRoutes from "./api/routes/agoraRoutes.js";
import mongoose from 'mongoose';
import VideoQueueEntry from './api/models/VideoQueueEntry.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_API_KEY_SID = process.env.TWILIO_API_KEY_SID;
const TWILIO_API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_API_KEY_SID || !TWILIO_API_KEY_SECRET) {
  console.error("\u274C Twilio credentials are missing! Check your .env file.");
  process.exit(1);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

connectDB();  

app.use('/api/profile', profileRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/likes', likeRoutes); 
app.use('/api/notifications', notificationRoutes);
app.use("/api/agora", agoraRoutes);

app.get('/room/:roomId', (req, res) => {
  const videoPath = path.join(__dirname, 'public', 'video.html');
  if (!fs.existsSync(videoPath)) return res.status(404).send("Video Call Page Not Found");
  res.sendFile(videoPath);
});

app.get('/', (req, res) => res.send('Server running \u2705'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const VIDEO_QUEUE_STALE_MS = 90 * 1000;
const VIDEO_QUEUE_CLEANUP_INTERVAL_MS = 30 * 1000;
const VIDEO_QUEUE_JOIN_WINDOW_MS = 2 * 60 * 1000;
const VIDEO_QUEUE_JOIN_MAX = 12;
const videoQueueJoinBuckets = new Map();

const normalizeInterests = (interests = []) =>
  Array.from(
    new Set(
      (Array.isArray(interests) ? interests : [])
        .map((interest) => String(interest || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );

const tokenizeInterest = (interest = "") =>
  String(interest || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim())
    .filter(Boolean);

const getInterestCharacters = (interest = "") =>
  String(interest || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "");

const createVideoRoomId = () =>
  `video_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const findSharedInterest = (first = [], second = []) => {
  const secondSet = new Set(second);
  for (const interest of first) {
    if (secondSet.has(interest)) {
      return interest;
    }
  }
  return null;
};

const getSharedWordMatch = (first = [], second = []) => {
  const secondWords = new Set(second.flatMap((interest) => tokenizeInterest(interest)));
  for (const interest of first) {
    for (const word of tokenizeInterest(interest)) {
      if (secondWords.has(word)) {
        return word;
      }
    }
  }
  return null;
};

const getCharacterPriorityScore = (source = "", target = "") => {
  const left = getInterestCharacters(source);
  const right = getInterestCharacters(target);

  if (!left || !right) {
    return 0;
  }

  let prefixScore = 0;
  const prefixLength = Math.min(left.length, right.length);
  for (let index = 0; index < prefixLength; index += 1) {
    if (left[index] !== right[index]) {
      break;
    }
    prefixScore += prefixLength - index;
  }

  const rightCharCounts = new Map();
  for (const char of right) {
    rightCharCounts.set(char, (rightCharCounts.get(char) || 0) + 1);
  }

  let overlapScore = 0;
  for (const char of left) {
    const count = rightCharCounts.get(char) || 0;
    if (count > 0) {
      overlapScore += 1;
      rightCharCounts.set(char, count - 1);
    }
  }

  return prefixScore * 100 + overlapScore;
};

const rankCandidateMatch = (requestedInterests = [], candidateInterests = []) => {
  const exactSharedInterest = findSharedInterest(requestedInterests, candidateInterests);
  if (exactSharedInterest) {
    return {
      priority: 3,
      score: exactSharedInterest.length,
      matchedInterest: exactSharedInterest,
    };
  }

  const sharedWord = getSharedWordMatch(requestedInterests, candidateInterests);
  if (sharedWord) {
    return {
      priority: 2,
      score: sharedWord.length,
      matchedInterest: sharedWord,
    };
  }

  let bestCharacterScore = 0;
  for (const requestedInterest of requestedInterests) {
    for (const candidateInterest of candidateInterests) {
      bestCharacterScore = Math.max(
        bestCharacterScore,
        getCharacterPriorityScore(requestedInterest, candidateInterest)
      );
    }
  }

  if (bestCharacterScore > 0) {
    return {
      priority: 1,
      score: bestCharacterScore,
      matchedInterest: null,
    };
  }

  return {
    priority: 0,
    score: 0,
    matchedInterest: null,
  };
};

const cleanupStaleVideoQueueEntries = async () => {
  const cutoff = new Date(Date.now() - VIDEO_QUEUE_STALE_MS);
  await VideoQueueEntry.updateMany(
    {
      status: "waiting",
      updatedAt: { $lt: cutoff },
    },
    {
      $set: {
        status: "left",
        disconnectedAt: new Date(),
        leftReason: "stale_timeout",
      },
    }
  );
};

const cleanupExpiredVideoJoinBuckets = () => {
  const now = Date.now();
  for (const [key, value] of videoQueueJoinBuckets.entries()) {
    if (value.resetAt <= now) {
      videoQueueJoinBuckets.delete(key);
    }
  }
};

const resetWaitingQueueOnBoot = async () => {
  try {
    await VideoQueueEntry.updateMany(
      { status: "waiting" },
      {
        $set: {
          status: "left",
          disconnectedAt: new Date(),
          leftReason: "server_restart",
        },
      }
    );
  } catch (error) {
    console.error("Failed to reset waiting queue on boot:", error.message);
  }
};

const logVideoQueueEvent = (event, details = {}) => {
  console.log(`[video-queue] ${event}`, {
    at: new Date().toISOString(),
    ...details,
  });
};

const leaveVideoQueue = async ({ userId, socketId, reason = "left" }) => {
  const filter = userId ? { userId } : socketId ? { socketId } : null;
  if (!filter) return null;

  const queueEntry = await VideoQueueEntry.findOne(filter);
  if (!queueEntry) {
    logVideoQueueEvent("leave_skipped_no_entry", { userId, socketId, reason });
    return null;
  }

  if (queueEntry.status === "waiting") {
    queueEntry.status = "left";
    queueEntry.disconnectedAt = new Date();
    queueEntry.leftReason = reason;
    queueEntry.socketId = "";
    await queueEntry.save();
    logVideoQueueEvent("left_waiting_queue", {
      userId: queueEntry.userId,
      socketId,
      reason,
    });
    return queueEntry;
  }

  logVideoQueueEvent("leave_skipped_non_waiting", {
    userId: queueEntry.userId,
    socketId,
    reason,
    status: queueEntry.status,
    matchedUserId: queueEntry.matchedUserId,
    roomId: queueEntry.roomId,
  });
  return queueEntry;
};

const joinVideoQueue = async ({ userId, socketId, interests }) => {
  const normalizedInterests = normalizeInterests(interests);
  const interestsForQueue = normalizedInterests.length ? normalizedInterests : ["any"];

  logVideoQueueEvent("join_requested", {
    userId,
    socketId,
    interests: interestsForQueue,
  });

  await cleanupStaleVideoQueueEntries();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let result = { type: "queued" };

    try {
      const currentEntry = await VideoQueueEntry.findOneAndUpdate(
        { userId },
        {
          $set: {
            socketId,
            interests: interestsForQueue,
            status: "waiting",
            matchedUserId: null,
            roomId: null,
            matchedInterest: null,
            matchedAt: null,
            disconnectedAt: null,
            leftReason: null,
          },
          $setOnInsert: {
            joinedAt: new Date(),
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );

      logVideoQueueEvent("current_entry_upserted", {
        userId,
        socketId,
        entryId: currentEntry._id.toString(),
        interests: currentEntry.interests || [],
      });

      const candidates = await VideoQueueEntry.find({
        userId: { $ne: userId },
        status: "waiting",
      }).sort({ joinedAt: 1, _id: 1 });

      logVideoQueueEvent("candidates_loaded", {
        userId,
        socketId,
        attempt: attempt + 1,
        candidateCount: candidates.length,
        candidates: candidates.map((candidate) => ({
          userId: candidate.userId,
          socketId: candidate.socketId,
          interests: candidate.interests || [],
          joinedAt: candidate.joinedAt,
        })),
      });

      let selectedCandidate = null;
      let matchedInterest = null;
      let selectedMatchRank = null;

      for (const candidate of candidates) {
        const matchRank = rankCandidateMatch(
          interestsForQueue,
          candidate.interests || []
        );

        logVideoQueueEvent("candidate_ranked", {
          userId,
          candidateUserId: candidate.userId,
          requestedInterests: interestsForQueue,
          candidateInterests: candidate.interests || [],
          priority: matchRank.priority,
          score: matchRank.score,
          matchedInterest: matchRank.matchedInterest,
        });

        if (
          !selectedCandidate ||
          matchRank.priority > selectedMatchRank.priority ||
          (matchRank.priority === selectedMatchRank.priority &&
            matchRank.score > selectedMatchRank.score)
        ) {
          selectedCandidate = candidate;
          matchedInterest = matchRank.matchedInterest;
          selectedMatchRank = matchRank;
        }
      }

      if (!selectedCandidate && candidates.length > 0) {
        selectedCandidate = candidates[0];
      }

      if (!selectedCandidate) {
        logVideoQueueEvent("queued_waiting_for_match", {
          userId,
          socketId,
          interests: interestsForQueue,
        });
        result = { type: "queued" };
        return result;
      }

      logVideoQueueEvent("candidate_selected", {
        userId,
        candidateUserId: selectedCandidate.userId,
        candidateSocketId: selectedCandidate.socketId,
        matchedInterest,
        matchPriority: selectedMatchRank?.priority ?? 0,
        matchScore: selectedMatchRank?.score ?? 0,
      });

      const roomId = createVideoRoomId();
      const matchedAt = new Date();

      const claimedCandidate = await VideoQueueEntry.findOneAndUpdate(
        {
          _id: selectedCandidate._id,
          status: "waiting",
        },
        {
          $set: {
            status: "matched",
            matchedUserId: userId,
            roomId,
            matchedInterest,
            matchedAt,
          },
        },
        { new: true }
      );

      if (!claimedCandidate) {
        logVideoQueueEvent("candidate_claim_failed_retry", {
          userId,
          candidateUserId: selectedCandidate.userId,
          roomId,
        });
        result = { type: "retry" };
      } else {
        const matchedCurrentEntry = await VideoQueueEntry.findOneAndUpdate(
          {
            _id: currentEntry._id,
            status: "waiting",
          },
          {
            $set: {
              status: "matched",
              matchedUserId: claimedCandidate.userId,
              roomId,
              matchedInterest,
              matchedAt,
            },
          },
          { new: true }
        );

        if (!matchedCurrentEntry) {
          logVideoQueueEvent("current_entry_match_failed_retry", {
            userId,
            candidateUserId: claimedCandidate.userId,
            roomId,
          });
          await VideoQueueEntry.updateOne(
            {
              _id: claimedCandidate._id,
              status: "matched",
              roomId,
            },
            {
              $set: {
                status: "waiting",
                matchedUserId: null,
                roomId: null,
                matchedInterest: null,
                matchedAt: null,
              },
            }
          );
          result = { type: "retry" };
        } else {
          logVideoQueueEvent("match_created", {
            userId,
            matchedUserId: claimedCandidate.userId,
            roomId,
            matchedInterest,
            requesterSocketId: socketId,
            matchedSocketId: claimedCandidate.socketId || "",
          });

          result = {
            type: "matched",
            room: roomId,
            matchedInterest,
            matchedUserId: claimedCandidate.userId,
            otherSocketId: claimedCandidate.socketId || "",
          };
        }
      }

      if (result.type !== "retry") {
        return result;
      }
    } catch (error) {
      logVideoQueueEvent("join_attempt_failed", {
        userId,
        socketId,
        attempt: attempt + 1,
        message: error.message,
      });
      if (attempt === 2) {
        throw error;
      }
    }
  }

  return { type: "queued" };
};

void resetWaitingQueueOnBoot();
setInterval(() => {
  void cleanupStaleVideoQueueEntries().catch((error) => {
    console.error("Video queue cleanup failed:", error.message);
  });
}, VIDEO_QUEUE_CLEANUP_INTERVAL_MS);
setInterval(cleanupExpiredVideoJoinBuckets, 60 * 1000).unref();

io.on("connection", (socket) => {
  logVideoQueueEvent("socket_connected", { socketId: socket.id });

  socket.on("join_video_queue", async ({ userId, interests }) => {
    try {
      logVideoQueueEvent("socket_join_event", {
        socketId: socket.id,
        userId: String(userId || ""),
        interests: normalizeInterests(interests),
      });

      if (!userId) {
        socket.emit("queue_error", { message: "Missing userId" });
        return;
      }

      const rateLimitKey = `video-join:${String(userId)}`;
      const now = Date.now();
      const currentBucket = videoQueueJoinBuckets.get(rateLimitKey);

      if (!currentBucket || currentBucket.resetAt <= now) {
        videoQueueJoinBuckets.set(rateLimitKey, {
          count: 1,
          resetAt: now + VIDEO_QUEUE_JOIN_WINDOW_MS,
        });
      } else {
        if (currentBucket.count >= VIDEO_QUEUE_JOIN_MAX) {
          socket.emit("queue_error", {
            message: "Too many queue join attempts. Please wait a moment and try again.",
          });
          return;
        }

        currentBucket.count += 1;
        videoQueueJoinBuckets.set(rateLimitKey, currentBucket);
      }

      socket.data.videoUserId = String(userId);
      socket.join(`video-user:${socket.data.videoUserId}`);

      const result = await joinVideoQueue({
        userId: String(userId),
        socketId: socket.id,
        interests,
      });

      if (result.type === "matched") {
        const payload = {
          matchedUserId: result.matchedUserId,
          room: result.room,
          matchedInterest: result.matchedInterest || null,
        };

        logVideoQueueEvent("emitting_match_found", {
          socketId: socket.id,
          userId: socket.data.videoUserId,
          matchedUserId: result.matchedUserId,
          roomId: result.room,
          matchedInterest: result.matchedInterest || null,
          targetSocketId: result.otherSocketId,
        });

        io.to(`video-user:${socket.data.videoUserId}`).emit("match_found", payload);
        if (result.matchedUserId) {
          io.to(`video-user:${result.matchedUserId}`).emit("match_found", {
            matchedUserId: socket.data.videoUserId,
            room: result.room,
            matchedInterest: result.matchedInterest || null,
          });
        }
        return;
      }

      logVideoQueueEvent("emitting_queue_joined", {
        socketId: socket.id,
        userId: socket.data.videoUserId,
        interests: normalizeInterests(interests),
      });

      socket.emit("queue_joined", {
        status: "waiting",
        interests: normalizeInterests(interests),
      });
    } catch (error) {
      console.error("join_video_queue error:", error);
      socket.emit("queue_error", { message: "Failed to join video queue" });
    }
  });

  socket.on("leave_video_queue", async ({ userId, reason }) => {
    try {
      const resolvedUserId = String(userId || socket.data.videoUserId || "");
      if (!resolvedUserId) return;
      logVideoQueueEvent("socket_leave_event", {
        socketId: socket.id,
        userId: resolvedUserId,
        reason: reason || "left",
      });
      await leaveVideoQueue({
        userId: resolvedUserId,
        socketId: socket.id,
        reason: reason || "left",
      });
      socket.leave(`video-user:${resolvedUserId}`);
      socket.emit("queue_left", { status: "left" });
    } catch (error) {
      console.error("leave_video_queue error:", error);
    }
  });

  socket.on("disconnect", async () => {
    try {
      logVideoQueueEvent("socket_disconnected", {
        socketId: socket.id,
        userId: socket.data.videoUserId || null,
      });
      await leaveVideoQueue({
        userId: socket.data.videoUserId,
        socketId: socket.id,
        reason: "disconnect",
      });
    } catch (error) {
      console.error("disconnect cleanup error:", error);
    }
  });
});

io.on("connection_error", (err) => console.error("WebSocket Error:", err.message));

server.listen(PORT, () => {
  console.log(`✅ HTTP Server running on port ${PORT}`);
  console.log(`✅ WebSocket Server running on port ${PORT}`);
});

