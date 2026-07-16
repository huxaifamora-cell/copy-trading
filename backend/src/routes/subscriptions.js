const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const copyFactoryService = require('../services/copyFactoryService');

const router = express.Router();
router.use(requireAuth);

// List the caller's active follows, across all their linked accounts
router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT s.id, s.size_scaling, s.max_drawdown_pct, s.status, s.created_at,
            tp.headline AS trader_headline, u.display_name AS trader_name,
            ma.nickname AS follower_account_nickname
     FROM subscriptions s
     JOIN mt_accounts ma ON ma.id = s.follower_account_id
     JOIN trader_profiles tp ON tp.id = s.trader_profile_id
     JOIN mt_accounts trader_ma ON trader_ma.id = tp.mt_account_id
     JOIN users u ON u.id = trader_ma.user_id
     WHERE ma.user_id = $1
     ORDER BY s.created_at DESC`,
    [req.userId]
  );
  res.json({ subscriptions: result.rows });
});

// Follow a trader — this is the one-tap "start copying" action
router.post('/', async (req, res) => {
  const { followerAccountId, traderProfileId, sizeScaling, maxDrawdownPct } = req.body;
  if (!followerAccountId || !traderProfileId) {
    return res.status(400).json({ error: 'followerAccountId and traderProfileId are required' });
  }

  const followerResult = await pool.query(
    'SELECT * FROM mt_accounts WHERE id = $1 AND user_id = $2',
    [followerAccountId, req.userId]
  );
  const followerAccount = followerResult.rows[0];
  if (!followerAccount) return res.status(404).json({ error: 'Follower account not found' });

  const traderResult = await pool.query(
    'SELECT * FROM trader_profiles WHERE id = $1 AND is_public = true',
    [traderProfileId]
  );
  const trader = traderResult.rows[0];
  if (!trader) return res.status(404).json({ error: 'Trader not found' });

  try {
    await copyFactoryService.subscribe({
      metaapiAccountId: followerAccount.metaapi_account_id,
      strategyId: trader.strategy_id,
      sizeScaling: sizeScaling ?? 1.0,
      maxDrawdownPct: maxDrawdownPct ?? 20,
    });

    const result = await pool.query(
      `INSERT INTO subscriptions (follower_account_id, trader_profile_id, size_scaling, max_drawdown_pct)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (follower_account_id, trader_profile_id)
       DO UPDATE SET status = 'active', size_scaling = $3, max_drawdown_pct = $4, stopped_at = NULL
       RETURNING *`,
      [followerAccount.id, trader.id, sizeScaling ?? 1.0, maxDrawdownPct ?? 20]
    );

    res.status(201).json({ subscription: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: 'Could not start copying this trader' });
  }
});

// Unfollow — stop copying, existing open positions are left as-is
router.delete('/:id', async (req, res) => {
  const result = await pool.query(
    `SELECT s.*, ma.metaapi_account_id, tp.strategy_id
     FROM subscriptions s
     JOIN mt_accounts ma ON ma.id = s.follower_account_id
     JOIN trader_profiles tp ON tp.id = s.trader_profile_id
     WHERE s.id = $1 AND ma.user_id = $2`,
    [req.params.id, req.userId]
  );
  const sub = result.rows[0];
  if (!sub) return res.status(404).json({ error: 'Subscription not found' });

  try {
    await copyFactoryService.unsubscribe(sub.metaapi_account_id, sub.strategy_id);
  } catch (err) {
    console.error('Failed to unsubscribe in CopyFactory, marking stopped locally anyway', err);
  }

  await pool.query(
    "UPDATE subscriptions SET status = 'stopped', stopped_at = now() WHERE id = $1",
    [sub.id]
  );
  res.status(204).send();
});

module.exports = router;
