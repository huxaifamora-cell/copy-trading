const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const metaApiService = require('../services/metaApiService');

const router = express.Router();
router.use(requireAuth);

// List the calling user's linked MT accounts
router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT id, broker_server, mt_login, platform, role, nickname, created_at
     FROM mt_accounts WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.userId]
  );
  res.json({ accounts: result.rows });
});

// Link a new MT4/5 account — this is the "no technical setup" moment for the user
router.post('/', async (req, res) => {
  const { login, password, server, platform, nickname } = req.body;
  if (!login || !password || !server || !platform) {
    return res.status(400).json({ error: 'login, password, server, and platform are required' });
  }
  if (!['mt4', 'mt5'].includes(platform)) {
    return res.status(400).json({ error: "platform must be 'mt4' or 'mt5'" });
  }

  try {
    const metaapiAccountId = await metaApiService.provisionAccount({
      login,
      password,
      server,
      platform,
    });

    const result = await pool.query(
      `INSERT INTO mt_accounts (user_id, broker_server, mt_login, platform, metaapi_account_id, nickname)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, broker_server, mt_login, platform, role, nickname, created_at`,
      [req.userId, server, login, platform, metaapiAccountId, nickname || null]
    );

    res.status(201).json({ account: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This account is already linked to your profile' });
    }
    console.error(err);
    res.status(502).json({ error: 'Could not connect to that MetaTrader account. Double check the login, password, and server name.' });
  }
});

// Live balance/equity + recent trade history for a linked account
router.get('/:id/snapshot', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM mt_accounts WHERE id = $1 AND user_id = $2',
    [req.params.id, req.userId]
  );
  const account = result.rows[0];
  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    const days = Number(req.query.days) || 30;
    const snapshot = await metaApiService.getAccountSnapshot(account.metaapi_account_id, days);
    res.json({ snapshot });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not fetch account details from MetaTrader right now' });
  }
});

// Unlink an account
router.delete('/:id', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM mt_accounts WHERE id = $1 AND user_id = $2',
    [req.params.id, req.userId]
  );
  const account = result.rows[0];
  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    await metaApiService.removeAccount(account.metaapi_account_id);
  } catch (err) {
    console.error('Failed to remove MetaApi account, continuing to unlink locally', err);
  }

  await pool.query('DELETE FROM mt_accounts WHERE id = $1', [account.id]);
  res.status(204).send();
});

module.exports = router;
