/**
 * Socket.IO Manager for P2P Chat System
 * Handles real-time communication with signaling server
 */

const io = typeof window !== 'undefined' ? require('socket.io-client') : null;

const SOCKET_EVENTS = {
  // Connection
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  AUTH: 'auth',
  AUTH_ERROR: 'auth_error',

  // Presence
  USER_ONLINE: 'user_online',
  USER_OFFLINE: 'user_offline',
  ONLINE_USERS: 'online_users',

  // Chat
  CHAT_MESSAGE: 'chat_message',
  MESSAGE_SENT: 'message_sent',
  MESSAGE_READ: 'message_read',
  MESSAGE_READ_RECEIPT: 'message_read_receipt',

  // Typing
  TYPING: 'typing',
  USER_TYPING: 'user_typing',

  // WebRTC Signaling
  SIGNAL: 'signal',
  TRANSFER_START: 'transfer_start',
  TRANSFER_PROGRESS: 'transfer_progress',
  TRANSFER_COMPLETE: 'transfer_complete',
  TRANSFER_ERROR: 'transfer_error',

  // Chat Connection State
  CHAT_CONNECTED: 'chat_connected',
  CHAT_DISCONNECTING: 'chat_disconnecting',
  CHAT_PEER_ONLINE: 'chat_peer_online',
  CHAT_PEER_OFFLINE: 'chat_peer_offline',

  // Error
  ERROR: 'error',
};

class SocketManager {
  constructor() {
    this.socket = null;
    this.listeners = {};
    this.serverURL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:3000';
  }

  // ── Connection Management ──────────────────────────────────────────
  connect(token) {
    if (this.socket && this.socket.connected) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.socket = io(this.serverURL, {
        auth: { token },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
      });

      this.socket.on(SOCKET_EVENTS.CONNECT, () => {
        console.log('[socket] connected');
        this.socket.emit(SOCKET_EVENTS.AUTH, token);
      });

      this.socket.on(SOCKET_EVENTS.AUTH_ERROR, (error) => {
        console.error('[socket] auth error:', error);
        reject(error);
      });

      this.socket.on(SOCKET_EVENTS.DISCONNECT, () => {
        console.log('[socket] disconnected');
        this.emit('disconnected');
      });

      this.socket.on(SOCKET_EVENTS.ERROR, (error) => {
        console.error('[socket] error:', error);
      });

      setTimeout(() => {
        if (this.socket.connected) {
          resolve();
        } else {
          reject(new Error('Socket connection timeout'));
        }
      }, 5000);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  isConnected() {
    return this.socket && this.socket.connected;
  }

  // ── Event Listeners ────────────────────────────────────────────────
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);

    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  emit(event, data) {
    if (this.socket) {
      this.socket.emit(event, data);
    }
  }

  // ── Chat Methods ───────────────────────────────────────────────────
  sendMessage(toUserId, content, messageId) {
    this.emit(SOCKET_EVENTS.CHAT_MESSAGE, {
      toUserId,
      content,
      messageType: 'text',
      messageId,
    });
  }

  sendTypingIndicator(toUserId, isTyping) {
    this.emit(SOCKET_EVENTS.TYPING, {
      toUserId,
      isTyping,
    });
  }

  markMessageAsRead(toUserId, messageId) {
    this.emit(SOCKET_EVENTS.MESSAGE_READ, {
      toUserId,
      messageId,
    });
  }

  // ── WebRTC Signaling ───────────────────────────────────────────────
  sendSignal(toUserId, payload, code) {
    this.emit(SOCKET_EVENTS.SIGNAL, {
      toUserId,
      payload,
      code,
    });
  }

  notifyTransferStart(toUserId, code, fileName, fileSize) {
    this.emit(SOCKET_EVENTS.TRANSFER_START, {
      toUserId,
      code,
      fileName,
      fileSize,
    });
  }

  notifyTransferProgress(toUserId, code, percent, bytes) {
    this.emit(SOCKET_EVENTS.TRANSFER_PROGRESS, {
      toUserId,
      code,
      percent,
      bytes,
    });
  }

  notifyTransferComplete(toUserId, code, fileName) {
    this.emit(SOCKET_EVENTS.TRANSFER_COMPLETE, {
      toUserId,
      code,
      fileName,
    });
  }

  notifyTransferError(toUserId, code, error) {
    this.emit(SOCKET_EVENTS.TRANSFER_ERROR, {
      toUserId,
      code,
      error,
    });
  }

  // ── Connection State ───────────────────────────────────────────────
  notifyChatConnected(withUserId) {
    this.emit(SOCKET_EVENTS.CHAT_CONNECTED, {
      withUserId,
    });
  }

  notifyChatDisconnecting(withUserId) {
    this.emit(SOCKET_EVENTS.CHAT_DISCONNECTING, {
      withUserId,
    });
  }
}

module.exports = new SocketManager();