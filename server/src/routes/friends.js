'use strict';

const express = require('express');
const router = express.Router();
const { authMiddleware, generateId } = require('../auth');
const { dbRun, dbGet, dbAll } = require('../db');

// ── POST /friends/request ────────────────────────────────────────────────
router.post('/request', authMiddleware, async (req, res) => {
  try {
    const { to_user_id } = req.body;
    const from_user_id = req.user.userId;

    if (!to_user_id) {
      return res.status(400).json({ error: 'Missing to_user_id' });
    }

    if (from_user_id === to_user_id) {
      return res.status(400).json({ error: 'Cannot send request to yourself' });
    }

    // Check if user exists
    const user = await dbGet('SELECT id FROM users WHERE id = ?', [to_user_id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if already friends
    const friendship = await dbGet(
      `SELECT id FROM friendships 
       WHERE (user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?)`,
      [from_user_id, to_user_id, to_user_id, from_user_id]
    );

    if (friendship) {
      return res.status(400).json({ error: 'Already friends' });
    }

    // Check if request already exists
    const existing = await dbGet(
      `SELECT id, status FROM friend_requests 
       WHERE from_user_id = ? AND to_user_id = ?`,
      [from_user_id, to_user_id]
    );

    if (existing) {
      return res.status(400).json({ error: `Request already ${existing.status}` });
    }

    const requestId = generateId();
    await dbRun(
      `INSERT INTO friend_requests (id, from_user_id, to_user_id, status) 
       VALUES (?, ?, ?, 'pending')`,
      [requestId, from_user_id, to_user_id]
    );

    res.status(201).json({ id: requestId, status: 'pending' });
    console.log(`[friends] request sent: ${from_user_id} -> ${to_user_id}`);
  } catch (err) {
    console.error('[friends] request error:', err);
    res.status(500).json({ error: 'Failed to send request' });
  }
});

// ── POST /friends/request/:requestId/accept ────────────────────────────
router.post('/request/:requestId/accept', authMiddleware, async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.userId;

    const request = await dbGet(
      'SELECT from_user_id, to_user_id, status FROM friend_requests WHERE id = ?',
      [requestId]
    );

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (request.to_user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ error: `Request already ${request.status}` });
    }

    // Create friendship
    const friendshipId = generateId();
    await dbRun(
      `INSERT INTO friendships (id, user_id_1, user_id_2) VALUES (?, ?, ?)`,
      [friendshipId, request.from_user_id, request.to_user_id]
    );

    // Update request status
    await dbRun('UPDATE friend_requests SET status = ? WHERE id = ?', ['accepted', requestId]);

    res.json({ id: friendshipId, status: 'accepted' });
    console.log(`[friends] request accepted: ${request.from_user_id} <-> ${request.to_user_id}`);
  } catch (err) {
    console.error('[friends] accept error:', err);
    res.status(500).json({ error: 'Failed to accept request' });
  }
});

// ── POST /friends/request/:requestId/reject ────────────────────────────
router.post('/request/:requestId/reject', authMiddleware, async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.userId;

    const request = await dbGet(
      'SELECT from_user_id, to_user_id, status FROM friend_requests WHERE id = ?',
      [requestId]
    );

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    if (request.to_user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await dbRun('UPDATE friend_requests SET status = ? WHERE id = ?', ['rejected', requestId]);

    res.json({ status: 'rejected' });
    console.log(`[friends] request rejected: ${requestId}`);
  } catch (err) {
    console.error('[friends] reject error:', err);
    res.status(500).json({ error: 'Failed to reject request' });
  }
});

// ── GET /friends/requests (incoming) ─────────────────────────────────────
router.get('/requests', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const requests = await dbAll(
      `SELECT fr.id, fr.from_user_id, fr.status, fr.created_at,
              u.username, u.avatar_url
       FROM friend_requests fr
       JOIN users u ON fr.from_user_id = u.id
       WHERE fr.to_user_id = ?
       ORDER BY fr.created_at DESC`,
      [userId]
    );

    res.json({ requests });
  } catch (err) {
    console.error('[friends] requests error:', err);
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// ── GET /friends (list friends) ──────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const friends = await dbAll(
      `SELECT u.id, u.username, u.avatar_url, u.status
       FROM friendships f
       JOIN users u ON (
         (f.user_id_1 = ? AND f.user_id_2 = u.id) OR
         (f.user_id_2 = ? AND f.user_id_1 = u.id)
       )
       ORDER BY u.username`,
      [userId, userId]
    );

    res.json({ friends });
  } catch (err) {
    console.error('[friends] list error:', err);
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

// ── DELETE /friends/:friendId ────────────────────────────────────────────
router.delete('/:friendId', authMiddleware, async (req, res) => {
  try {
    const { friendId } = req.params;
    const userId = req.user.userId;

    const friendship = await dbGet(
      'SELECT id FROM friendships WHERE ((user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?))',
      [userId, friendId, friendId, userId]
    );

    if (!friendship) {
      return res.status(404).json({ error: 'Friendship not found' });
    }

    await dbRun('DELETE FROM friendships WHERE id = ?', [friendship.id]);

    res.json({ success: true });
    console.log(`[friends] friendship deleted: ${userId} <-> ${friendId}`);
  } catch (err) {
    console.error('[friends] delete error:', err);
    res.status(500).json({ error: 'Failed to delete friendship' });
  }
});

module.exports = router;
