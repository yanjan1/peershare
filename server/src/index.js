'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const { initSchema } = require('./db');
const { decodeToken } = require('./auth');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const friendsRoutes = require('./routes/friends');
const messagesRoutes = require('./routes/messages');

const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:7337';

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGIN, methods: ['GET', 'POST'] },
});

// ── Initialize database ──────────────────────────────────────────────────
initSchema();

// ── REST Routes ──────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/messages', messagesRoutes);

// ── Health check ─────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), version: '2.0.0' });
});

// ── Socket.IO: Connection & Presence ─────────────────────────────────────

const connectedUsers = new Map(); // userId -> { socketId, username, status }
const userSockets = new Map(); // userId -> Set of socketIds (for multiple connections)

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  // ── User authentication & online status ──────────────────────────────
  socket.on('auth', (token) => {
    const decoded = decodeToken(token);

    if (!decoded) {
      socket.emit('auth_error', { message: 'Invalid token' });
      return;
    }

    const userId = decoded.userId;
    const username = decoded.username;

    connectedUsers.set(userId, {
      socketId: socket.id,
      username,
      status: 'online',
    });

    // Track multiple sockets per user
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket.id);

    socket.userId = userId;
    socket.username = username;
    socket.join(`user:${userId}`);

    console.log(`[socket] user authenticated: ${username} (${userId})`);

    // Notify all connected users that this user is online
    io.emit('user_online', { userId, username, status: 'online' });

    // Send current online users to this client
    const onlineUsers = Array.from(connectedUsers.entries()).map(([uid, data]) => ({
      userId: uid,
      username: data.username,
      status: data.status,
    }));

    socket.emit('online_users', { users: onlineUsers });
  });

  // ── Chat Messages (P2P, real-time) ───────────────────────────────────
  socket.on('chat_message', ({ toUserId, content, messageType = 'text', messageId }) => {
    if (!socket.userId) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    // Check if recipient is online
    const recipientConnected = connectedUsers.has(toUserId);

    // Emit message to recipient if online
    io.to(`user:${toUserId}`).emit('chat_message', {
      id: messageId,
      fromUserId: socket.userId,
      fromUsername: socket.username,
      toUserId,
      content,
      messageType,
      delivered: recipientConnected,
      created_at: new Date().toISOString(),
    });

    // Confirm to sender
    socket.emit('message_sent', {
      messageId,
      delivered: recipientConnected,
      deliveredAt: new Date().toISOString(),
    });

    console.log(`[chat] message: ${socket.userId} -> ${toUserId} (delivered: ${recipientConnected})`);
  });

  // ── Typing Indicators ────────────────────────────────────────────────
  socket.on('typing', ({ toUserId, isTyping }) => {
    io.to(`user:${toUserId}`).emit('user_typing', {
      fromUserId: socket.userId,
      fromUsername: socket.username,
      isTyping,
    });
  });

  // ── Read Receipts ───────────────────────────────────────────────────
  socket.on('message_read', ({ toUserId, messageId }) => {
    io.to(`user:${toUserId}`).emit('message_read_receipt', {
      fromUserId: socket.userId,
      messageId,
      readAt: new Date().toISOString(),
    });
  });

  // ── WebRTC Signaling (for file transfer in chat) ────────────────────
  socket.on('signal', ({ toUserId, payload, code }) => {
    const toSocket = io.to(`user:${toUserId}`);
    if (toSocket) {
      toSocket.emit('signal', {
        fromUserId: socket.userId,
        fromUsername: socket.username,
        payload,
        code,
      });
      console.log(`[signal] ${socket.userId} -> ${toUserId}`);
    }
  });

  // ── File transfer events (WebRTC DataChannel) ────────────────────────
  socket.on('transfer_start', ({ toUserId, code, fileName, fileSize }) => {
    io.to(`user:${toUserId}`).emit('transfer_start', {
      fromUserId: socket.userId,
      fromUsername: socket.username,
      code,
      fileName,
      fileSize,
    });
    console.log(`[transfer] started: ${socket.userId} -> ${toUserId} (${fileName})`);
  });

  socket.on('transfer_progress', ({ toUserId, code, percent, bytes }) => {
    io.to(`user:${toUserId}`).emit('transfer_progress', {
      code,
      percent,
      bytes,
    });
  });

  socket.on('transfer_complete', ({ toUserId, code, fileName }) => {
    io.to(`user:${toUserId}`).emit('transfer_complete', {
      code,
      fromUserId: socket.userId,
      fileName,
    });
    console.log(`[transfer] complete: ${socket.userId} -> ${toUserId} (${fileName})`);
  });

  socket.on('transfer_error', ({ toUserId, code, error }) => {
    io.to(`user:${toUserId}`).emit('transfer_error', {
      code,
      fromUserId: socket.userId,
      error,
    });
  });

  // ── Chat state sync (for disconnection alerts) ───────────────────────
  socket.on('chat_connected', ({ withUserId }) => {
    io.to(`user:${withUserId}`).emit('chat_peer_online', {
      userId: socket.userId,
      username: socket.username,
    });
  });

  socket.on('chat_disconnecting', ({ withUserId }) => {
    io.to(`user:${withUserId}`).emit('chat_peer_offline', {
      userId: socket.userId,
      username: socket.username,
    });
  });

  // ── Disconnection ────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const userId = socket.userId;

    if (userId) {
      // Remove socket from user's connection set
      if (userSockets.has(userId)) {
        userSockets.get(userId).delete(socket.id);
        
        // Only mark offline if no other connections
        if (userSockets.get(userId).size === 0) {
          connectedUsers.delete(userId);
          userSockets.delete(userId);
          io.emit('user_offline', { userId, status: 'offline' });
          console.log(`[socket] user fully disconnected: ${userId}`);
        }
      }
    }

    console.log(`[socket] disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`✦ p2p-chat signaling server running on http://localhost:${PORT}`);
  console.log(`  allowed origin: ${ALLOWED_ORIGIN}`);
  console.log(`  database: ./data/peershare.db`);
});
