const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const copyFactoryService = require('../services/copyFactoryService');
const { notify } = require('../services/notify');

const router = express.Router();
router.use(requireAuth);

// List the caller's follows (any status), across all their linked accounts
router.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT s.id, s.risk_settings, s.status, s.created_at,
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

// Follow a trader with a chosen risk configuration
router.post('/', async (req, res) => {
  const { followerAccountId, traderProfileId, riskSettings } = req.body;
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

  const settings = riskSettings || { lotSizing: { mode: 'mirror' } };

  try {
    await copyFactoryService.subscribe({
      metaapiAccountId: followerAccount.metaapi_account_id,
      strategyId: trader.strategy_id,
      riskSettings: settings,
    });

    const result = await pool.query(
      `INSERT INTO subscriptions (follower_account_id, trader_profile_id, risk_settings, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (follower_account_id, trader_profile_id)
       DO UPDATE SET status = 'active', risk_settings = $3, stopped_at = NULL
       RETURNING *`,
      [followerAccount.id, trader.id, JSON.stringify(settings)]
    );

    res.status(201).json({ subscription: result.rows[0] });
    notify(req.userId, 'follow_started', `Started copying "${trader.headline}"`);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: `Could not start copying this trader: ${err.message || 'unknown error'}` });
  }
});

// Update risk settings on an existing follow without unfollowing/refollowing
router.put('/:id', async (req, res) => {
  const { riskSettings } = req.body;
  if (!riskSettings) return res.status(400).json({ error: 'riskSettings is required' });

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
    if (sub.status === 'active') {
      await copyFactoryService.subscribe({
        metaapiAccountId: sub.metaapi_account_id,
        strategyId: sub.strategy_id,
        riskSettings,
      });
    }
    const updated = await pool.query(
      'UPDATE subscriptions SET risk_settings = $1 WHERE id = $2 RETURNING *',
      [JSON.stringify(riskSettings), sub.id]
    );
    res.json({ subscription: updated.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: `Could not update risk settings: ${err.message || 'unknown error'}` });
  }
});

// Pause — lighter than unfollow. Stops copying but keeps the risk
// settings and relationship, so it can be resumed later without
// reconfiguring everything.
router.post('/:id/pause', async (req, res) => {
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
  if (sub.status !== 'active') return res.status(400).json({ error: 'Subscription is not active' });

  try {
    await copyFactoryService.unsubscribe(sub.metaapi_account_id, sub.strategy_id);
  } catch (err) {
    console.error('Failed to unsubscribe in CopyFactory while pausing:', err.message);
  }
  await pool.query("UPDATE subscriptions SET status = 'paused' WHERE id = $1", [sub.id]);
  res.status(204).send();
});

router.post('/:id/resume', async (req, res) => {
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
  if (sub.status !== 'paused') return res.status(400).json({ error: 'Subscription is not paused' });

  try {
    await copyFactoryService.subscribe({
      metaapiAccountId: sub.metaapi_account_id,
      strategyId: sub.strategy_id,
      riskSettings: sub.risk_settings,
    });
    await pool.query("UPDATE subscriptions SET status = 'active' WHERE id = $1", [sub.id]);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: `Could not resume copying: ${err.message || 'unknown error'}` });
  }
});

// Unfollow — stop copying permanently, existing open positions are left as-is
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
  notify(req.userId, 'follow_stopped', 'Stopped copying a trader');
});

module.exports = router;
