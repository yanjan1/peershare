'use strict';

const express = require('express');
const router = express.Router();
const { authMiddleware, generateId } = require('../auth');
const { dbRun, dbGet, dbAll } = require('../db');

// ── GET /api/users/search?q=query ───────────────────────────────────────
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    const userId = req.user.userId;

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    const users = await dbAll(
      `SELECT id, username, avatar_url, status FROM users 
       WHERE (username LIKE ? OR email LIKE ?) AND id != ?
       ORDER BY username ASC
       LIMIT 20`,
      [`%${q}%`, `%${q}%`, userId]
    );

    res.json({ users });
  } catch (err) {
    console.error('[users] search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ── GET /api/users/:userId ──────────────────────────────────────────────
router.get('/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await dbGet(
      'SELECT id, username, email, avatar_url, status, created_at FROM users WHERE id = ?',
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (err) {
    console.error('[users] get error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ── GET /api/users/:userId/status ───────────────────────────────────────
router.get('/:userId/status', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await dbGet('SELECT id, status FROM users WHERE id = ?', [userId]);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ status: user.status });
  } catch (err) {
    console.error('[users] status error:', err);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

module.exports = router;
