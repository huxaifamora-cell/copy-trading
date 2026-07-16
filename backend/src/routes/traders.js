const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const copyFactoryService = require('../services/copyFactoryService');

const router = express.Router();

// Public marketplace — anyone logged in can browse traders to follow
router.get('/', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT tp.id, tp.headline, tp.description, tp.created_at,
            u.display_name AS trader_name,
            (SELECT count(*) FROM subscriptions s
              WHERE s.trader_profile_id = tp.id AND s.status = 'active') AS follower_count
     FROM trader_profiles tp
     JOIN mt_accounts ma ON ma.id = tp.mt_account_id
     JOIN users u ON u.id = ma.user_id
     WHERE tp.is_public = true
     ORDER BY follower_count DESC`
  );
  res.json({ traders: result.rows });
});

// Turn one of the caller's own linked accounts into a followable strategy
router.post('/', requireAuth, async (req, res) => {
  const { mtAccountId, headline, description } = req.body;
  if (!mtAccountId || !headline) {
    return res.status(400).json({ error: 'mtAccountId and headline are required' });
  }

  const acctResult = await pool.query(
    'SELECT * FROM mt_accounts WHERE id = $1 AND user_id = $2',
    [mtAccountId, req.userId]
  );
  const account = acctResult.rows[0];
  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    const strategyId = await copyFactoryService.createStrategy({
      metaapiAccountId: account.metaapi_account_id,
      name: headline,
      description,
    });

    await pool.query("UPDATE mt_accounts SET role = 'trader' WHERE id = $1", [account.id]);

    const result = await pool.query(
      `INSERT INTO trader_profiles (mt_account_id, strategy_id, headline, description)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [account.id, strategyId, headline, description || null]
    );

    res.status(201).json({ traderProfile: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not set up this account as a followable strategy' });
  }
});

module.exports = router;
