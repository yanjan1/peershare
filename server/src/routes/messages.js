'use strict';

const express = require('express');
const router = express.Router();
const { authMiddleware, generateId } = require('../auth');
const { dbRun, dbGet, dbAll } = require('../db');

// ── POST /api/messages/send ──────────────────────────────────────────
// Send a message (stored if recipient offline)
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const { to_user_id, content, message_type = 'text', file_metadata } = req.body;
    const from_user_id = req.user.userId;

    if (!to_user_id || !content) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (from_user_id === to_user_id) {
      return res.status(400).json({ error: 'Cannot message yourself' });
    }

    // Check if users are friends
    const friendship = await dbGet(
      `SELECT id FROM friendships 
       WHERE (user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?)`,
      [from_user_id, to_user_id, to_user_id, from_user_id]
    );

    if (!friendship) {
      return res.status(403).json({ error: 'Can only message friends' });
    }

    const messageId = generateId();
    const fileMetadataJson = file_metadata ? JSON.stringify(file_metadata) : null;

    await dbRun(
      `INSERT INTO messages (id, from_user_id, to_user_id, content, message_type, file_metadata, is_read)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      [messageId, from_user_id, to_user_id, content, message_type, fileMetadataJson]
    );

    // Update or create chat session
    const chatSession = await dbGet(
      `SELECT id FROM chat_sessions 
       WHERE (user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?)`,
      [from_user_id, to_user_id, to_user_id, from_user_id]
    );

    if (chatSession) {
      await dbRun(
        'UPDATE chat_sessions SET last_message_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [messageId, chatSession.id]
      );
    } else {
      const sessionId = generateId();
      await dbRun(
        `INSERT INTO chat_sessions (id, user_id_1, user_id_2, last_message_id)
         VALUES (?, ?, ?, ?)`,
        [sessionId, from_user_id, to_user_id, messageId]
      );
    }

    res.status(201).json({
      id: messageId,
      from_user_id,
      to_user_id,
      content,
      message_type,
      is_read: false,
      created_at: new Date().toISOString(),
    });

    console.log(`[messages] sent: ${from_user_id} -> ${to_user_id}`);
  } catch (err) {
    console.error('[messages] send error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ── GET /api/messages/conversation/:userId ───────────────────────────
// Get chat history with a specific user
router.get('/conversation/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.userId;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    if (userId === currentUserId) {
      return res.status(400).json({ error: 'Invalid user' });
    }

    // Check if users are friends
    const friendship = await dbGet(
      `SELECT id FROM friendships 
       WHERE (user_id_1 = ? AND user_id_2 = ?) OR (user_id_1 = ? AND user_id_2 = ?)`,
      [currentUserId, userId, userId, currentUserId]
    );

    if (!friendship) {
      return res.status(403).json({ error: 'Not friends with this user' });
    }

    const messages = await dbAll(
      `SELECT id, from_user_id, to_user_id, content, message_type, file_metadata, is_read, created_at
       FROM messages
       WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [currentUserId, userId, userId, currentUserId, limit, offset]
    );

    // Reverse to get chronological order
    messages.reverse();

    // Parse file_metadata JSON
    const parsedMessages = messages.map(msg => ({
      ...msg,
      file_metadata: msg.file_metadata ? JSON.parse(msg.file_metadata) : null,
    }));

    res.json({ messages: parsedMessages });
  } catch (err) {
    console.error('[messages] conversation error:', err);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

// ── POST /api/messages/:messageId/read ───────────────────────────────
// Mark a message as read
router.post('/:messageId/read', authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.userId;

    const message = await dbGet(
      'SELECT id, to_user_id FROM messages WHERE id = ?',
      [messageId]
    );

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.to_user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await dbRun('UPDATE messages SET is_read = 1 WHERE id = ?', [messageId]);

    res.json({ success: true });
  } catch (err) {
    console.error('[messages] read error:', err);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// ── POST /api/messages/sync ──────────────────────────────────────────
// Sync unread messages and chat history (for offline sync)
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get unread messages
    const unreadMessages = await dbAll(
      `SELECT m.id, m.from_user_id, m.to_user_id, m.content, m.message_type, 
              m.file_metadata, m.is_read, m.created_at, u.username, u.avatar_url
       FROM messages m
       JOIN users u ON m.from_user_id = u.id
       WHERE m.to_user_id = ? AND m.is_read = 0
       ORDER BY m.created_at DESC`,
      [userId]
    );

    // Get active chat sessions
    const chatSessions = await dbAll(
      `SELECT cs.id, cs.user_id_1, cs.user_id_2, 
              CASE 
                WHEN cs.user_id_1 = ? THEN cs.user_id_2
                ELSE cs.user_id_1
              END as other_user_id,
              u.id, u.username, u.avatar_url, u.status,
              m.id as last_message_id, m.content as last_message_content, m.created_at as last_message_time
       FROM chat_sessions cs
       JOIN users u ON (
         CASE 
           WHEN cs.user_id_1 = ? THEN u.id = cs.user_id_2
           ELSE u.id = cs.user_id_1
         END
       )
       LEFT JOIN messages m ON m.id = cs.last_message_id
       WHERE cs.user_id_1 = ? OR cs.user_id_2 = ?
       ORDER BY cs.updated_at DESC`,
      [userId, userId, userId, userId]
    );

    const parsedMessages = unreadMessages.map(msg => ({
      ...msg,
      file_metadata: msg.file_metadata ? JSON.parse(msg.file_metadata) : null,
    }));

    res.json({
      unreadMessages: parsedMessages,
      chatSessions: chatSessions || [],
      syncTime: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[messages] sync error:', err);
    res.status(500).json({ error: 'Failed to sync messages' });
  }
});

// ── GET /api/messages/unread-count ───────────────────────────────────
// Get count of unread messages
router.get('/unread-count', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await dbGet(
      'SELECT COUNT(*) as count FROM messages WHERE to_user_id = ? AND is_read = 0',
      [userId]
    );

    res.json({ unreadCount: result.count || 0 });
  } catch (err) {
    console.error('[messages] unread-count error:', err);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// ── DELETE /api/messages/:messageId ──────────────────────────────────
// Delete a message (only sender can delete)
router.delete('/:messageId', authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.userId;

    const message = await dbGet(
      'SELECT id, from_user_id FROM messages WHERE id = ?',
      [messageId]
    );

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.from_user_id !== userId) {
      return res.status(403).json({ error: 'Can only delete your own messages' });
    }

    await dbRun('DELETE FROM messages WHERE id = ?', [messageId]);

    res.json({ success: true });
  } catch (err) {
    console.error('[messages] delete error:', err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

module.exports = router;