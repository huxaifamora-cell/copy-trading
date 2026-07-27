const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { generateToken } = require('../services/tokens');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/email');

const router = express.Router();

// The frontend URL is needed to build links that go inside emails
// (verify/reset). Falls back to CORS_ORIGIN since that's already
// configured as "the frontend's URL" elsewhere.
const APP_URL = process.env.APP_URL || process.env.CORS_ORIGIN || 'http://localhost:5173';

async function issueVerificationToken(userId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  await pool.query(
    'INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  );
  return token;
}

router.post('/signup', async (req, res) => {
  const { email, password, displayName } = req.body;
  if (!email || !password || !displayName) {
    return res.status(400).json({ error: 'email, password, and displayName are required' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3) RETURNING id, email, display_name, email_verified`,
      [email.toLowerCase(), passwordHash, displayName]
    );
    const user = result.rows[0];

    const verifyToken = await issueVerificationToken(user.id);
    await sendVerificationEmail(user.email, `${APP_URL}/verify-email?token=${verifyToken}`);

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not create account' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      email_verified: user.email_verified,
    },
  });
});

// ---------- Email verification ----------

router.post('/verify-email', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });

  const result = await pool.query(
    'SELECT * FROM email_verification_tokens WHERE token = $1 AND expires_at > now()',
    [token]
  );
  const record = result.rows[0];
  if (!record) return res.status(400).json({ error: 'This verification link is invalid or has expired' });

  await pool.query('UPDATE users SET email_verified = true WHERE id = $1', [record.user_id]);
  await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [record.user_id]);
  res.json({ ok: true });
});

router.post('/resend-verification', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = result.rows[0];
  // Deliberately vague response either way — don't reveal whether an
  // account exists for this email.
  if (!user || user.email_verified) {
    return res.json({ ok: true });
  }

  await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [user.id]);
  const verifyToken = await issueVerificationToken(user.id);
  await sendVerificationEmail(user.email, `${APP_URL}/verify-email?token=${verifyToken}`);
  res.json({ ok: true });
});

// ---------- Password reset ----------

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = result.rows[0];

  // Same email either way, whether or not the account exists — avoids
  // leaking which emails are registered.
  if (user) {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1h
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );
    await sendPasswordResetEmail(user.email, `${APP_URL}/reset-password?token=${token}`);
  }

  res.json({ ok: true, message: 'If that email is registered, a reset link has been sent.' });
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'token and password are required' });

  const result = await pool.query(
    'SELECT * FROM password_reset_tokens WHERE token = $1 AND used = false AND expires_at > now()',
    [token]
  );
  const record = result.rows[0];
  if (!record) return res.status(400).json({ error: 'This reset link is invalid or has expired' });

  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, record.user_id]);
  await pool.query('UPDATE password_reset_tokens SET used = true WHERE id = $1', [record.id]);
  res.json({ ok: true });
});

module.exports = router;
