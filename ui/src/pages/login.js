import { API } from '../utils/api.js';
import { storage } from '../utils/storage.js';
import { socket } from '../utils/socket.js';

export class LoginPage {
  async render() {
    return `
      <div class="auth-container">
        <div class="auth-card">
          <div class="auth-header">
            <h1>🔗 PeerShare</h1>
            <p>P2P Chat & File Sharing</p>
          </div>

          <form id="loginForm" class="auth-form">
            <div class="form-group">
              <label for="username">Username</label>
              <input type="text" id="username" placeholder="Enter your username" required />
            </div>

            <div class="form-group">
              <label for="password">Password</label>
              <input type="password" id="password" placeholder="Enter your password" required />
            </div>

            <button type="submit" class="btn btn-primary btn-block">Login</button>
          </form>

          <div class="auth-footer">
            <p>Don't have an account? <a href="#/signup">Sign up</a></p>
          </div>

          <div id="errorMessage" class="error-message" style="display: none;"></div>
        </div>
      </div>
    `;
  }

  async mount() {
    const form = document.getElementById('loginForm');
    const errorDiv = document.getElementById('errorMessage');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorDiv.style.display = 'none';

      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;

      try {
        const response = await API.login(username, password);
        const { token, user } = response;

        storage.saveToken(token);
        storage.saveUser(user);
        API.setToken(token);

        await socket.connect(token);
        window.location.hash = '#/chats';
      } catch (error) {
        errorDiv.textContent = error.message || 'Login failed';
        errorDiv.style.display = 'block';
      }
    });
  }
}
