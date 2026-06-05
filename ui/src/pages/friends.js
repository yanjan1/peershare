import { API } from '../utils/api.js';
import { socket } from '../utils/socket.js';

export class FriendsPage {
  constructor() {
    this.friends = [];
    this.friendRequests = [];
    this.searchResults = [];
  }

  async render() {
    return `
      <div class="friends-layout">
        <div class="friends-header">
          <h2>Friends</h2>
          <a href="#/chats" class="btn btn-secondary">Back</a>
        </div>

        <div class="friends-search">
          <input type="text" id="friendSearch" placeholder="Search users..." />
          <div id="searchResults" class="search-results" style="display: none;"></div>
        </div>

        <div class="friends-tabs">
          <button class="tab-btn active" data-tab="friends">Friends</button>
          <button class="tab-btn" data-tab="requests">Requests</button>
        </div>

        <div id="friendsTab" class="tab-content active">
          <div id="friendsList" class="friends-list"></div>
        </div>

        <div id="requestsTab" class="tab-content">
          <div id="requestsList" class="friends-list"></div>
        </div>
      </div>
    `;
  }

  async mount() {
    await this.loadFriends();
    await this.loadFriendRequests();
    this.setupEventListeners();
  }

  async loadFriends() {
    try {
      const response = await API.getFriends();
      this.friends = response.friends || [];
      this.renderFriends();
    } catch (error) {
      console.error('Failed to load friends:', error);
    }
  }

  async loadFriendRequests() {
    try {
      const response = await API.getFriendRequests();
      this.friendRequests = response.requests || [];
      this.renderRequests();
    } catch (error) {
      console.error('Failed to load requests:', error);
    }
  }

  renderFriends() {
    const list = document.getElementById('friendsList');
    if (this.friends.length === 0) {
      list.innerHTML = '<div class="empty-list">No friends yet. Search and add friends!</div>';
      return;
    }

    list.innerHTML = this.friends
      .map(
        (friend) => `
      <div class="friend-item">
        <div class="friend-info">
          <div class="friend-name">${friend.username}</div>
          <div class="friend-status ${friend.status}">${friend.status === 'online' ? 'Online' : 'Offline'}</div>
        </div>
        <div class="friend-actions">
          <button class="btn btn-sm btn-primary" onclick="window.location.hash='#/chat-detail/${friend.id}'">Message</button>
          <button class="btn btn-sm btn-danger" data-action="remove" data-friend-id="${friend.id}">Remove</button>
        </div>
      </div>
    `
      )
      .join('');

    list.querySelectorAll('[data-action="remove"]').forEach((btn) => {
      btn.addEventListener('click', () => this.removeFriend(btn.dataset.friendId));
    });
  }

  renderRequests() {
    const list = document.getElementById('requestsList');
    if (this.friendRequests.length === 0) {
      list.innerHTML = '<div class="empty-list">No pending requests</div>';
      return;
    }

    list.innerHTML = this.friendRequests
      .filter((req) => req.status === 'pending')
      .map(
        (req) => `
      <div class="request-item">
        <div class="request-info">
          <div class="request-name">${req.username}</div>
        </div>
        <div class="request-actions">
          <button class="btn btn-sm btn-primary" data-action="accept" data-request-id="${req.id}">Accept</button>
          <button class="btn btn-sm btn-secondary" data-action="reject" data-request-id="${req.id}">Reject</button>
        </div>
      </div>
    `
      )
      .join('');

    list.querySelectorAll('[data-action="accept"]').forEach((btn) => {
      btn.addEventListener('click', () => this.acceptRequest(btn.dataset.requestId));
    });

    list.querySelectorAll('[data-action="reject"]').forEach((btn) => {
      btn.addEventListener('click', () => this.rejectRequest(btn.dataset.requestId));
    });
  }

  setupEventListeners() {
    const searchInput = document.getElementById('friendSearch');
    const resultsDiv = document.getElementById('searchResults');

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach((t) => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`${btn.dataset.tab}Tab`).classList.add('active');
      });
    });

    searchInput.addEventListener('input', async (e) => {
      const query = e.target.value.trim();
      if (query.length < 2) {
        resultsDiv.style.display = 'none';
        return;
      }

      try {
        const response = await API.searchUsers(query);
        this.searchResults = response.users || [];
        this.renderSearchResults();
        resultsDiv.style.display = 'block';
      } catch (error) {
        console.error('Search failed:', error);
      }
    });
  }

  renderSearchResults() {
    const div = document.getElementById('searchResults');
    div.innerHTML = this.searchResults
      .map(
        (user) => `
      <div class="search-result-item">
        <div class="result-name">${user.username}</div>
        <button class="btn btn-sm btn-primary" data-action="add-friend" data-user-id="${user.id}">Add Friend</button>
      </div>
    `
      )
      .join('');

    div.querySelectorAll('[data-action="add-friend"]').forEach((btn) => {
      btn.addEventListener('click', () => this.sendFriendRequest(btn.dataset.userId));
    });
  }

  async sendFriendRequest(userId) {
    try {
      await API.sendFriendRequest(userId);
      alert('Friend request sent!');
      document.getElementById('friendSearch').value = '';
      document.getElementById('searchResults').style.display = 'none';
    } catch (error) {
      alert(error.message || 'Failed to send request');
    }
  }

  async acceptRequest(requestId) {
    try {
      await API.acceptFriendRequest(requestId);
      await this.loadFriends();
      await this.loadFriendRequests();
    } catch (error) {
      console.error('Failed to accept request:', error);
    }
  }

  async rejectRequest(requestId) {
    try {
      await API.rejectFriendRequest(requestId);
      await this.loadFriendRequests();
    } catch (error) {
      console.error('Failed to reject request:', error);
    }
  }

  async removeFriend(friendId) {
    if (!confirm('Remove this friend?')) return;

    try {
      await API.removeFriend(friendId);
      await this.loadFriends();
    } catch (error) {
      console.error('Failed to remove friend:', error);
    }
  }
}
