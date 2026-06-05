/**
 * IndexedDB Manager for P2P Chat System
 * Handles persistent storage of chat history and larger data
 */

const DB_NAME = 'peershare';
const DB_VERSION = 1;
const STORE_NAMES = {
  MESSAGES: 'messages',
  CONVERSATIONS: 'conversations',
  DRAFTS: 'drafts',
};

class IndexedDBManager {
  constructor() {
    this.db = null;
  }

  // ── Initialize Database ─────────────────────────────────────────────────
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Messages store: indexed by conversationId and timestamp
        if (!db.objectStoreNames.contains(STORE_NAMES.MESSAGES)) {
          const messageStore = db.createObjectStore(STORE_NAMES.MESSAGES, { keyPath: 'id' });
          messageStore.createIndex('conversationId', 'conversationId');
          messageStore.createIndex('timestamp', 'created_at');
          messageStore.createIndex('isRead', 'is_read');
        }

        // Conversations store
        if (!db.objectStoreNames.contains(STORE_NAMES.CONVERSATIONS)) {
          const convStore = db.createObjectStore(STORE_NAMES.CONVERSATIONS, { keyPath: 'id' });
          convStore.createIndex('userId', 'other_user_id');
          convStore.createIndex('updatedAt', 'updated_at');
        }

        // Draft messages store
        if (!db.objectStoreNames.contains(STORE_NAMES.DRAFTS)) {
          db.createObjectStore(STORE_NAMES.DRAFTS, { keyPath: 'conversationId' });
        }
      };
    });
  }

  // ── Messages Operations ──────────────────────────────────────────────────
  async saveMessage(message) {
    const tx = this.db.transaction([STORE_NAMES.MESSAGES], 'readwrite');
    const store = tx.objectStore(STORE_NAMES.MESSAGES);
    return new Promise((resolve, reject) => {
      const request = store.put(message);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(message);
    });
  }

  async saveMessages(messages) {
    const tx = this.db.transaction([STORE_NAMES.MESSAGES], 'readwrite');
    const store = tx.objectStore(STORE_NAMES.MESSAGES);
    return new Promise((resolve, reject) => {
      messages.forEach(msg => store.put(msg));
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve(messages);
    });
  }

  async getMessages(conversationId, limit = 50) {
    const tx = this.db.transaction([STORE_NAMES.MESSAGES], 'readonly');
    const store = tx.objectStore(STORE_NAMES.MESSAGES);
    const index = store.index('conversationId');
    return new Promise((resolve, reject) => {
      const request = index.getAll(conversationId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const messages = request.result.slice(-limit);
        resolve(messages);
      };
    });
  }

  async deleteMessage(messageId) {
    const tx = this.db.transaction([STORE_NAMES.MESSAGES], 'readwrite');
    const store = tx.objectStore(STORE_NAMES.MESSAGES);
    return new Promise((resolve, reject) => {
      const request = store.delete(messageId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clearConversationMessages(conversationId) {
    const tx = this.db.transaction([STORE_NAMES.MESSAGES], 'readwrite');
    const store = tx.objectStore(STORE_NAMES.MESSAGES);
    const index = store.index('conversationId');
    return new Promise((resolve, reject) => {
      const request = index.openCursor(conversationId);
      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
    });
  }

  // ── Conversations Operations ─────────────────────────────────────────────
  async saveConversation(conversation) {
    const tx = this.db.transaction([STORE_NAMES.CONVERSATIONS], 'readwrite');
    const store = tx.objectStore(STORE_NAMES.CONVERSATIONS);
    return new Promise((resolve, reject) => {
      const request = store.put(conversation);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(conversation);
    });
  }

  async getConversations() {
    const tx = this.db.transaction([STORE_NAMES.CONVERSATIONS], 'readonly');
    const store = tx.objectStore(STORE_NAMES.CONVERSATIONS);
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async deleteConversation(conversationId) {
    const tx = this.db.transaction([STORE_NAMES.CONVERSATIONS], 'readwrite');
    const store = tx.objectStore(STORE_NAMES.CONVERSATIONS);
    return new Promise((resolve, reject) => {
      const request = store.delete(conversationId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  // ── Draft Messages ──────────────────────────────────────────────────────
  async saveDraft(conversationId, content) {
    const tx = this.db.transaction([STORE_NAMES.DRAFTS], 'readwrite');
    const store = tx.objectStore(STORE_NAMES.DRAFTS);
    return new Promise((resolve, reject) => {
      const request = store.put({ conversationId, content, savedAt: new Date().toISOString() });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getDraft(conversationId) {
    const tx = this.db.transaction([STORE_NAMES.DRAFTS], 'readonly');
    const store = tx.objectStore(STORE_NAMES.DRAFTS);
    return new Promise((resolve, reject) => {
      const request = store.get(conversationId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async deleteDraft(conversationId) {
    const tx = this.db.transaction([STORE_NAMES.DRAFTS], 'readwrite');
    const store = tx.objectStore(STORE_NAMES.DRAFTS);
    return new Promise((resolve, reject) => {
      const request = store.delete(conversationId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  // ── Clear All Data ──────────────────────────────────────────────────────
  async clearAll() {
    const tx = this.db.transaction(
      [STORE_NAMES.MESSAGES, STORE_NAMES.CONVERSATIONS, STORE_NAMES.DRAFTS],
      'readwrite'
    );
    return new Promise((resolve, reject) => {
      tx.objectStore(STORE_NAMES.MESSAGES).clear();
      tx.objectStore(STORE_NAMES.CONVERSATIONS).clear();
      tx.objectStore(STORE_NAMES.DRAFTS).clear();
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();
    });
  }
}

module.exports = new IndexedDBManager();