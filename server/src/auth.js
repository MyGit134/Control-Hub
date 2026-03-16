const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const TOKEN_NAME = 'auth_token';

function signToken(user) {
  const payload = {
    id: user.id,
    role: user.role,
    email: user.email,
    can_run_multi: user.can_run_multi || 0,
    token_version: user.token_version || 0,
  };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function setAuthCookie(res, token) {
  const secure =
    process.env.COOKIE_SECURE === 'true' ||
    process.env.COOKIE_SECURE === '1' ||
    process.env.NODE_ENV === 'production';
  res.cookie(TOKEN_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 12 * 60 * 60 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(TOKEN_NAME);
}

function getUserById(id) {
  return db
    .prepare('SELECT id, email, role, can_run_multi, token_version, created_at FROM users WHERE id = ?')
    .get(id);
}

function authRequired(req, res, next) {
  try {
    const token = req.cookies[TOKEN_NAME];
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    const payload = verifyToken(token);
    const user = getUserById(payload.id);
    if (!user) return res.status(401).json({ error: 'Invalid session' });
    if ((payload.token_version || 0) !== (user.token_version || 0)) {
      return res.status(401).json({ error: 'Invalid session' });
    }
    req.user = user;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  return next();
}

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

module.exports = {
  TOKEN_NAME,
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  getUserById,
  authRequired,
  adminOnly,
  hashPassword,
  verifyPassword,
};

