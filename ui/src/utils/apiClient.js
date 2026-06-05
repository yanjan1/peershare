/**
 * API Client for P2P Chat System
 * Handles all REST API calls to the server
 */

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000/api';

class APIClient {
  constructor() {
    this.baseURL = API_BASE_URL;
    this.token = null;
  }

  setToken(token) {
    this.token = token;
  }

  getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: this.getHeaders(),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `API Error: ${response.status}`);
    }
    return data;
  }

  // ── Auth Endpoints ──────────────────────────────────────────────────────
  async signup(username, email, password) {
    return this.request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
  }

  async login(username, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  async getMe() {
    return this.request('/auth/me');
  }

  async updateProfile(avatarUrl) {
    return this.request('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({ avatar_url: avatarUrl }),
    });
  }

  // ── Users Endpoints ─────────────────────────────────────────────────────
  async searchUsers(query) {
    return this.request(`/users/search?q=${encodeURIComponent(query)}`);
  }

  async getUser(userId) {
    return this.request(`/users/${userId}`);
  }

  async getUserStatus(userId) {
    return this.request(`/users/${userId}/status`);
  }

  // ── Friends Endpoints ───────────────────────────────────────────────────
  async sendFriendRequest(toUserId) {
    return this.request('/friends/request', {
      method: 'POST',
      body: JSON.stringify({ to_user_id: toUserId }),
    });
  }

  async acceptFriendRequest(requestId) {
    return this.request(`/friends/request/${requestId}/accept`, {
      method: 'POST',
    });
  }

  async rejectFriendRequest(requestId) {
    return this.request(`/friends/request/${requestId}/reject`, {
      method: 'POST',
    });
  }

  async getFriendRequests() {
    return this.request('/friends/requests');
  }

  async getFriends() {
    return this.request('/friends');
  }

  async removeFriend(friendId) {
    return this.request(`/friends/${friendId}`, {
      method: 'DELETE',
    });
  }

  // ── Messages Endpoints ──────────────────────────────────────────────────
  async sendMessage(toUserId, content, messageType = 'text', fileMetadata = null) {
    return this.request('/messages/send', {
      method: 'POST',
      body: JSON.stringify({
        to_user_id: toUserId,
        content,
        message_type: messageType,
        file_metadata: fileMetadata,
      }),
    });
  }

  async getConversation(userId, limit = 50, offset = 0) {
    return this.request(
      `/messages/conversation/${userId}?limit=${limit}&offset=${offset}`
    );
  }

  async markMessageAsRead(messageId) {
    return this.request(`/messages/${messageId}/read`, {
      method: 'POST',
    });
  }

  async syncMessages() {
    return this.request('/messages/sync', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async getUnreadCount() {
    return this.request('/messages/unread-count');
  }

  async deleteMessage(messageId) {
    return this.request(`/messages/${messageId}`, {
      method: 'DELETE',
    });
  }
}

module.exports = new APIClient();