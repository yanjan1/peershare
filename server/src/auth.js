'use strict';

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRY = '7d';

// ── Password hashing ────────────────────────────────────────────────────

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, 'sha512')
    .toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, hashedPassword) {
  const [salt, hash] = hashedPassword.split(':');
  const verify = crypto
    .pbkdf2Sync(password, salt, 100000, 64, 'sha512')
    .toString('hex');
  return verify === hash;
}

// ── JWT tokens ───────────────────────────────────────────────────────────

function generateToken(userId, username) {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

function decodeToken(token) {
  try {
    return jwt.decode(token);
  } catch (err) {
    return null;
  }
}

// ── Middleware ───────────────────────────────────────────────────────────

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = decoded;
  next();
}

// ── Generate UUID ────────────────────────────────────────────────────────

function generateId() {
  return crypto.randomUUID();
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  decodeToken,
  authMiddleware,
  generateId,
};
