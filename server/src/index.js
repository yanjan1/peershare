'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:7337';
const ROOM_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// ─── App Setup ────────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

// ─── In-memory Room Store ─────────────────────────────────────────────────────
// rooms = Map<code, { sender, receiver, meta, expiryTimer, state }>
const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateCode() : code; // ensure uniqueness
}

function destroyRoom(code, reason) {
  const room = rooms.get(code);
  if (!room) return;

  clearTimeout(room.expiryTimer);
  rooms.delete(code);

  console.log(`[room:${code}] destroyed — reason: ${reason}`);

  // Notify any sockets still in the room
  io.to(code).emit(reason === 'expired' ? 'room_expired' : 'peer_disconnected', { code, reason });

  // Force-leave the Socket.IO room so lingering sockets get cleaned up
  // (Socket.IO handles this on disconnect, but we be explicit)
}

function scheduleExpiry(code) {
  const room = rooms.get(code);
  if (!room) return;
  clearTimeout(room.expiryTimer);
  room.expiryTimer = setTimeout(() => {
    if (rooms.has(code)) {
      console.log(`[room:${code}] expired after timeout`);
      destroyRoom(code, 'expired');
    }
  }, ROOM_EXPIRY_MS);
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', rooms: rooms.size, uptime: process.uptime() });
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`);

  // ── create_room ─────────────────────────────────────────────────────────────
  // Sender creates a room and gets a code back
  socket.on('create_room', ({ meta } = {}) => {
    const code = generateCode();

    const room = {
      code,
      sender: socket.id,
      receiver: null,
      meta: meta || null, // { name, size, type } from sender
      state: 'waiting',   // waiting | connected | transferring | done
      expiryTimer: null,
    };
    rooms.set(code, room);
    scheduleExpiry(code);

    socket.join(code);
    socket.data.code = code;
    socket.data.role = 'sender';

    socket.emit('room_created', { code, meta });
    console.log(`[room:${code}] created by sender ${socket.id}`);
  });

  // ── join_room ────────────────────────────────────────────────────────────────
  // Receiver joins by code
  socket.on('join_room', ({ code } = {}) => {
    const room = rooms.get(code);

    if (!room) {
      socket.emit('room_error', { code, message: 'Room not found or expired.' });
      return;
    }
    if (room.receiver) {
      socket.emit('room_error', { code, message: 'Room already has a receiver.' });
      return;
    }

    room.receiver = socket.id;
    room.state = 'connected';
    clearTimeout(room.expiryTimer); // stop expiry once both peers are here
    room.expiryTimer = null;

    socket.join(code);
    socket.data.code = code;
    socket.data.role = 'receiver';

    console.log(`[room:${code}] receiver ${socket.id} joined`);

    // Tell BOTH peers they're ready to begin WebRTC negotiation
    // Include file meta so receiver knows what's coming
    io.to(code).emit('peer_ready', {
      code,
      meta: room.meta,
      sender: room.sender,
      receiver: room.receiver,
    });
  });

  // ── signal ───────────────────────────────────────────────────────────────────
  // Relay WebRTC signaling messages (offer, answer, ICE candidates)
  socket.on('signal', ({ code, payload } = {}) => {
    const room = rooms.get(code);
    if (!room) return;

    // Forward to the other peer in the room
    socket.to(code).emit('signal', { from: socket.id, payload });
  });

  // ── transfer_start ───────────────────────────────────────────────────────────
  socket.on('transfer_start', ({ code } = {}) => {
    const room = rooms.get(code);
    if (!room) return;
    room.state = 'transferring';
    socket.to(code).emit('transfer_start', { code });
    console.log(`[room:${code}] transfer started`);
  });

  // ── transfer_progress ────────────────────────────────────────────────────────
  // Relay progress so both peers stay in sync
  socket.on('transfer_progress', ({ code, percent, bytes } = {}) => {
    const room = rooms.get(code);
    if (!room) return;
    socket.to(code).emit('transfer_progress', { code, percent, bytes });
  });

  // ── transfer_complete ────────────────────────────────────────────────────────
  socket.on('transfer_complete', ({ code } = {}) => {
    const room = rooms.get(code);
    if (!room) return;
    room.state = 'done';
    console.log(`[room:${code}] transfer complete`);
    io.to(code).emit('transfer_complete', { code });
    // Destroy room after brief delay so both peers get the event
    setTimeout(() => destroyRoom(code, 'complete'), 3000);
  });

  // ── cancel_transfer ──────────────────────────────────────────────────────────
  socket.on('cancel_transfer', ({ code } = {}) => {
    console.log(`[room:${code}] cancelled by ${socket.id}`);
    io.to(code).emit('peer_disconnected', { code, reason: 'cancelled' });
    destroyRoom(code, 'cancelled');
  });

  // ── disconnect ───────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[socket] disconnected: ${socket.id}`);
    const code = socket.data.code;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    // Only destroy if transfer wasn't already finished
    if (room.state !== 'done') {
      destroyRoom(code, 'peer_left');
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`✦ p2p-share signaling server running on http://localhost:${PORT}`);
  console.log(`  allowed origin: ${ALLOWED_ORIGIN}`);
  console.log(`  room expiry: ${ROOM_EXPIRY_MS / 1000}s`);
});
