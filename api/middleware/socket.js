import { Server } from "socket.io";

const matchmakingQueue = new Map();

const matchmakingSocket = (server) => {
  const io = new Server(server);

  io.on("connection", (socket) => {
    console.log("User connected", socket.id);

    // User joins the matchmaking queue
    socket.on("join_video_queue", (data) => {
      const { userId, interests } = data;
      matchmakingQueue.set(userId, interests);

      // Look for a match in the queue
      for (let [otherUserId, otherInterests] of matchmakingQueue.entries()) {
        if (userId !== otherUserId && interests.some(i => otherInterests.includes(i))) {
          // Match found, remove users from the queue
          matchmakingQueue.delete(userId);
          matchmakingQueue.delete(otherUserId);

          // Generate a room ID
          const room = `room-${Date.now()}`;

          // Emit match found event to both users
          io.to(socket.id).emit("match_found", { matchedUserId: otherUserId, room });
          io.emit("match_found", { matchedUserId: userId, room });
          break;
        }
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected");
    });
  });

  return io;
};

export default matchmakingSocket;
