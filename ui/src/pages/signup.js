import { API } from '../utils/api.js';
import { storage } from '../utils/storage.js';
import { socket } from '../utils/socket.js';

export class SignupPage {
  async render() {
    return `
      <div class="auth-container">
        <div class="auth-card">
          <div class="auth-header">
            <h1>🔗 PeerShare</h1>
            <p>Create Account</p>
          </div>

          <form id="signupForm" class="auth-form">
            <div class="form-group">
              <label for="username">Username</label>
              <input type="text" id="username" placeholder="Choose a username" required />
            </div>

            <div class="form-group">
              <label for="email">Email</label>
              <input type="email" id="email" placeholder="Enter your email" required />
            </div>

            <div class="form-group">
              <label for="password">Password</label>
              <input type="password" id="password" placeholder="At least 6 characters" required />
            </div>

            <div class="form-group">
              <label for="confirmPassword">Confirm Password</label>
              <input type="password" id="confirmPassword" placeholder="Confirm password" required />
            </div>

            <button type="submit" class="btn btn-primary btn-block">Create Account</button>
          </form>

          <div class="auth-footer">
            <p>Already have an account? <a href="#/login">Login</a></p>
          </div>

          <div id="errorMessage" class="error-message" style="display: none;"></div>
        </div>
      </div>
    `;
  }

  async mount() {
    const form = document.getElementById('signupForm');
    const errorDiv = document.getElementById('errorMessage');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorDiv.style.display = 'none';

      const username = document.getElementById('username').value;
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirmPassword').value;

      if (password !== confirmPassword) {
        errorDiv.textContent = 'Passwords do not match';
        errorDiv.style.display = 'block';
        return;
      }

      if (password.length < 6) {
        errorDiv.textContent = 'Password must be at least 6 characters';
        errorDiv.style.display = 'block';
        return;
      }

      try {
        const response = await API.signup(username, email, password);
        const { token, user } = response;

        storage.saveToken(token);
        storage.saveUser(user);
        API.setToken(token);

        await socket.connect(token);
        window.location.hash = '#/chats';
      } catch (error) {
        errorDiv.textContent = error.message || 'Signup failed';
        errorDiv.style.display = 'block';
      }
    });
  }
}
