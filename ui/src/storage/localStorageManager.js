/**
 * LocalStorage Manager for P2P Chat System
 * Handles client-side data persistence using browser's localStorage
 */

const STORAGE_KEYS = {
  AUTH_TOKEN: 'peershare_auth_token',
  CURRENT_USER: 'peershare_current_user',
  CONVERSATIONS: 'peershare_conversations',
  MESSAGE_CACHE: 'peershare_messages',
  FRIENDS_LIST: 'peershare_friends',
  LAST_SYNC: 'peershare_last_sync',
  PENDING_MESSAGES: 'peershare_pending_messages',
};

class LocalStorageManager {
  // ── Authentication ──────────────────────────────────────────────────
  saveToken(token) {
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
  }

  getToken() {
    return localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
  }

  clearToken() {
    localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  }

  // ── Current User ────────────────────────────────────────────────────
  saveCurrentUser(user) {
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(user));
  }

  getCurrentUser() {
    const user = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    return user ? JSON.parse(user) : null;
  }

  // ── Conversations ───────────────────────────────────────────────────
  saveConversations(conversations) {
    localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(conversations));
  }

  getConversations() {
    const convs = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
    return convs ? JSON.parse(convs) : [];
  }

  addConversation(conversation) {
    const convs = this.getConversations();
    const index = convs.findIndex(c => c.id === conversation.id);
    if (index > -1) {
      convs[index] = conversation;
    } else {
      convs.push(conversation);
    }
    this.saveConversations(convs);
  }

  // ── Messages Cache ──────────────────────────────────────────────────
  // Stores messages per conversation (userId -> messages[])
  saveMessages(userId, messages) {
    const cache = this.getMessagesCache();
    cache[userId] = messages;
    localStorage.setItem(STORAGE_KEYS.MESSAGE_CACHE, JSON.stringify(cache));
  }

  getMessages(userId) {
    const cache = this.getMessagesCache();
    return cache[userId] || [];
  }

  getMessagesCache() {
    const cache = localStorage.getItem(STORAGE_KEYS.MESSAGE_CACHE);
    return cache ? JSON.parse(cache) : {};
  }

  addMessage(userId, message) {
    const messages = this.getMessages(userId);
    const index = messages.findIndex(m => m.id === message.id);
    if (index > -1) {
      messages[index] = message;
    } else {
      messages.push(message);
    }
    this.saveMessages(userId, messages);
  }

  clearMessages(userId) {
    const cache = this.getMessagesCache();
    delete cache[userId];
    localStorage.setItem(STORAGE_KEYS.MESSAGE_CACHE, JSON.stringify(cache));
  }

  // ── Pending Messages ────────────────────────────────────────────────
  // Messages waiting to be sent when online
  getPendingMessages() {
    const pending = localStorage.getItem(STORAGE_KEYS.PENDING_MESSAGES);
    return pending ? JSON.parse(pending) : [];
  }

  addPendingMessage(message) {
    const pending = this.getPendingMessages();
    pending.push({
      ...message,
      createdAt: new Date().toISOString(),
    });
    localStorage.setItem(STORAGE_KEYS.PENDING_MESSAGES, JSON.stringify(pending));
  }

  removePendingMessage(messageId) {
    let pending = this.getPendingMessages();
    pending = pending.filter(m => m.id !== messageId);
    localStorage.setItem(STORAGE_KEYS.PENDING_MESSAGES, JSON.stringify(pending));
  }

  clearPendingMessages() {
    localStorage.removeItem(STORAGE_KEYS.PENDING_MESSAGES);
  }

  // ── Friends List ────────────────────────────────────────────────────
  saveFriends(friends) {
    localStorage.setItem(STORAGE_KEYS.FRIENDS_LIST, JSON.stringify(friends));
  }

  getFriends() {
    const friends = localStorage.getItem(STORAGE_KEYS.FRIENDS_LIST);
    return friends ? JSON.parse(friends) : [];
  }

  // ── Sync Tracking ───────────────────────────────────────────────────
  saveLastSyncTime(timestamp) {
    localStorage.setItem(STORAGE_KEYS.LAST_SYNC, timestamp);
  }

  getLastSyncTime() {
    return localStorage.getItem(STORAGE_KEYS.LAST_SYNC);
  }

  // ── Clear All ───────────────────────────────────────────────────────
  clearAll() {
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
  }
}

module.exports = new LocalStorageManager();