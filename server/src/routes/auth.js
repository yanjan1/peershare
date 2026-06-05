'use strict';

const express = require('express');
const router = express.Router();
const {
  hashPassword,
  verifyPassword,
  generateToken,
  authMiddleware,
  generateId,
} = require('./auth');
const { dbRun, dbGet, dbAll } = require('./db');

// ── POST /auth/signup ────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existing = await dbGet('SELECT id FROM users WHERE username = ? OR email = ?', [
      username,
      email,
    ]);

    if (existing) {
      return res.status(409).json({ error: 'Username or email already taken' });
    }

    const userId = generateId();
    const passwordHash = hashPassword(password);

    await dbRun(
      `INSERT INTO users (id, username, email, password_hash, status) 
       VALUES (?, ?, ?, ?, 'online')`,
      [userId, username, email, passwordHash]
    );

    const token = generateToken(userId, username);

    res.status(201).json({
      user: { id: userId, username, email },
      token,
    });

    console.log(`[auth] user signed up: ${username}`);
  } catch (err) {
    console.error('[auth] signup error:', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// ── POST /auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Missing username or password' });
    }

    const user = await dbGet('SELECT id, password_hash, email FROM users WHERE username = ?', [
      username,
    ]);

    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user.id, username);

    res.json({
      user: { id: user.id, username, email: user.email },
      token,
    });

    console.log(`[auth] user logged in: ${username}`);
  } catch (err) {
    console.error('[auth] login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── GET /auth/me (verify token) ──────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await dbGet(
      'SELECT id, username, email, avatar_url, status FROM users WHERE id = ?',
      [req.user.userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (err) {
    console.error('[auth] me error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ── PUT /auth/profile ────────────────────────────────────────────────────
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { avatar_url } = req.body;
    const userId = req.user.userId;

    await dbRun('UPDATE users SET avatar_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
      avatar_url || null,
      userId,
    ]);

    const user = await dbGet(
      'SELECT id, username, email, avatar_url, status FROM users WHERE id = ?',
      [userId]
    );

    res.json({ user });
    console.log(`[auth] user profile updated: ${userId}`);
  } catch (err) {
    console.error('[auth] profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;
