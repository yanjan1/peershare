import { storage } from '../utils/storage.js';
import { socket } from '../utils/socket.js';

export class SettingsPage {
  async render() {
    const user = storage.getUser();
    return `
      <div class="settings-layout">
        <div class="settings-header">
          <h2>Settings</h2>
          <a href="#/chats" class="btn btn-secondary">Back</a>
        </div>

        <div class="settings-card">
          <div class="settings-section">
            <h3>Profile</h3>
            <div class="setting-item">
              <label>Username</label>
              <div class="setting-value">${user?.username || 'Unknown'}</div>
            </div>
            <div class="setting-item">
              <label>Email</label>
              <div class="setting-value">${user?.email || 'Unknown'}</div>
            </div>
          </div>

          <div class="settings-section">
            <h3>Preferences</h3>
            <div class="setting-item">
              <label>
                <input type="checkbox" id="notificationsEnabled" checked />
                Enable notifications
              </label>
            </div>
            <div class="setting-item">
              <label>
                <input type="checkbox" id="soundEnabled" checked />
                Sound alerts
              </label>
            </div>
          </div>

          <div class="settings-section danger">
            <h3>Danger Zone</h3>
            <button id="logoutBtn" class="btn btn-danger btn-block">Logout</button>
          </div>
        </div>
      </div>
    `;
  }

  async mount() {
    document.getElementById('logoutBtn').addEventListener('click', () => {
      if (confirm('Are you sure you want to logout?')) {
        storage.clearAll();
        socket.disconnect();
        window.location.hash = '#/login';
      }
    });
  }
}
