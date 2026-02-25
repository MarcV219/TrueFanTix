import { Server as SocketIOServer } from "socket.io";
import { createServer } from "http";
import { prisma } from "./prisma";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

// Active connections map: userId -> socket[]
const userSockets = new Map<string, any[]>();

// Room management: eventId -> userIds[]
const eventRooms = new Map<string, Set<string>>();

export function initializeWebSocketServer(httpServer: any) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/api/socket",
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error("Authentication required"));
      }

      const decoded = jwt.verify(token, JWT_SECRET) as any;
      socket.data.userId = decoded.userId;
      socket.data.userEmail = decoded.email;
      
      next();
    } catch (err) {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId;
    
    console.log(`[WS] User ${userId} connected`);
    
    // Track user's sockets
    if (!userSockets.has(userId)) {
      userSockets.set(userId, []);
    }
    userSockets.get(userId)?.push(socket);

    // Join user's personal room
    socket.join(`user:${userId}`);

    // Handle event room subscription
    socket.on("subscribe:event", (eventId: string) => {
      socket.join(`event:${eventId}`);
      
      if (!eventRooms.has(eventId)) {
        eventRooms.set(eventId, new Set());
      }
      eventRooms.get(eventId)?.add(userId);
      
      console.log(`[WS] User ${userId} subscribed to event ${eventId}`);
    });

    // Handle unsubscribe
    socket.on("unsubscribe:event", (eventId: string) => {
      socket.leave(`event:${eventId}`);
      eventRooms.get(eventId)?.delete(userId);
    });

    // Handle typing indicators for chat
    socket.on("typing:start", (data: { conversationId: string }) => {
      socket.to(`conversation:${data.conversationId}`).emit("typing:start", {
        userId,
        conversationId: data.conversationId,
      });
    });

    socket.on("typing:stop", (data: { conversationId: string }) => {
      socket.to(`conversation:${data.conversationId}`).emit("typing:stop", {
        userId,
        conversationId: data.conversationId,
      });
    });

    // Handle disconnect
    socket.on("disconnect", () => {
      console.log(`[WS] User ${userId} disconnected`);
      
      const sockets = userSockets.get(userId);
      if (sockets) {
        const index = sockets.indexOf(socket);
        if (index > -1) {
          sockets.splice(index, 1);
        }
        if (sockets.length === 0) {
          userSockets.delete(userId);
        }
      }

      // Clean up event rooms
      eventRooms.forEach((users, eventId) => {
        users.delete(userId);
      });
    });
  });

  return io;
}

// Send real-time notification to specific user
export function sendNotificationToUser(userId: string, notification: any) {
  const sockets = userSockets.get(userId);
  
  if (sockets && sockets.length > 0) {
    sockets.forEach(socket => {
      socket.emit("notification:new", notification);
    });
    return true;
  }
  
  return false; // User not online
}

// Broadcast to all users subscribed to an event
export function broadcastToEvent(eventId: string, event: string, data: any) {
  const io = getIO();
  if (io) {
    io.to(`event:${eventId}`).emit(event, data);
  }
}

// Send to all connected clients (for system-wide announcements)
export function broadcastToAll(event: string, data: any) {
  const io = getIO();
  if (io) {
    io.emit(event, data);
  }
}

// Get online users count
export function getOnlineUsersCount(): number {
  return userSockets.size;
}

// Check if user is online
export function isUserOnline(userId: string): boolean {
  const sockets = userSockets.get(userId);
  return !!sockets && sockets.length > 0;
}

// Global IO instance
let ioInstance: SocketIOServer | null = null;

export function setIO(io: SocketIOServer) {
  ioInstance = io;
}

export function getIO(): SocketIOServer | null {
  return ioInstance;
}

// Types for client
export interface ServerToClientEvents {
  "notification:new": (notification: any) => void;
  "ticket:update": (data: { ticketId: string; updates: any }) => void;
  "order:update": (data: { orderId: string; status: string }) => void;
  "price:drop": (data: { ticketId: string; oldPrice: number; newPrice: number }) => void;
  "typing:start": (data: { userId: string; conversationId: string }) => void;
  "typing:stop": (data: { userId: string; conversationId: string }) => void;
  "message:new": (message: any) => void;
  "system:announcement": (data: { title: string; message: string }) => void;
}

export interface ClientToServerEvents {
  "subscribe:event": (eventId: string) => void;
  "unsubscribe:event": (eventId: string) => void;
  "typing:start": (data: { conversationId: string }) => void;
  "typing:stop": (data: { conversationId: string }) => void;
}
