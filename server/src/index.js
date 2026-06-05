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

// ── Health check ─────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), version: '2.0.0' });
});

// ── Socket.IO: Connection & Presence ─────────────────────────────────────

const connectedUsers = new Map(); // userId -> { socketId, username, status }

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
  socket.on('transfer_start', ({ toUserId, code }) => {
    io.to(`user:${toUserId}`).emit('transfer_start', {
      fromUserId: socket.userId,
      fromUsername: socket.username,
      code,
    });
    console.log(`[transfer] started: ${socket.userId} -> ${toUserId}`);
  });

  socket.on('transfer_progress', ({ toUserId, code, percent, bytes }) => {
    io.to(`user:${toUserId}`).emit('transfer_progress', {
      code,
      percent,
      bytes,
    });
  });

  socket.on('transfer_complete', ({ toUserId, code }) => {
    io.to(`user:${toUserId}`).emit('transfer_complete', {
      code,
      fromUserId: socket.userId,
    });
    console.log(`[transfer] complete: ${socket.userId} -> ${toUserId}`);
  });

  // ── Typing indicators ────────────────────────────────────────────────
  socket.on('typing', ({ toUserId, isTyping }) => {
    io.to(`user:${toUserId}`).emit('user_typing', {
      fromUserId: socket.userId,
      fromUsername: socket.username,
      isTyping,
    });
  });

  // ── Chat state sync (for disconnection alerts) ───────────────────────
  socket.on('chat_connected', ({ withUserId }) => {
    io.to(`user:${withUserId}`).emit('chat_peer_online', {
      userId: socket.userId,
      username: socket.username,
    });
  });

  // ── Disconnection ────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const userId = socket.userId;

    if (userId) {
      connectedUsers.delete(userId);
      io.emit('user_offline', { userId, status: 'offline' });
      console.log(`[socket] user disconnected: ${userId}`);
    }

    console.log(`[socket] disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`✦ p2p-chat signaling server running on http://localhost:${PORT}`);
  console.log(`  allowed origin: ${ALLOWED_ORIGIN}`);
  console.log(`  database: ./data/peershare.db`);
});
