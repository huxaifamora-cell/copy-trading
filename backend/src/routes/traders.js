const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const copyFactoryService = require('../services/copyFactoryService');
const metaApiService = require('../services/metaApiService');
const { notify } = require('../services/notify');

const router = express.Router();

// Milestones a trader must hit before they're allowed to charge a fee.
// These are app-level policy constants, not something CopyFactory or
// MetaApi enforces — kept here so they're easy to find/tune in one place.
const MILESTONE_MIN_FOLLOWERS = 20;
const MILESTONE_MIN_SUCCESS_RATE = 55; // percent, over trailing 90 days
const SUCCESS_RATE_WINDOW_DAYS = 90;

async function computeSuccessRate(metaapiAccountId) {
  try {
    const snapshot = await metaApiService.getAccountSnapshot(metaapiAccountId, SUCCESS_RATE_WINDOW_DAYS);
    if (!snapshot.trades.length) return null;
    const wins = snapshot.trades.filter((t) => t.profit > 0).length;
    return Math.round((wins / snapshot.trades.length) * 1000) / 10; // one decimal place
  } catch (err) {
    console.error('Could not compute success rate:', err.message);
    return null;
  }
}

// Public marketplace — anyone logged in can browse traders to follow
router.get('/', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT tp.id, tp.headline, tp.description, tp.created_at, tp.fee_enabled, tp.fee_cents,
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
    // CopyFactory rejects strategy creation unless the account is flagged
    // as a PROVIDER — accounts default to SUBSCRIBER-only at link time
    // (see metaApiService.provisionAccount), so grant this the moment a
    // user chooses to become a trader.
    await metaApiService.grantProviderRole(account.metaapi_account_id);

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
    notify(req.userId, 'became_trader', `"${headline}" is now listed in the marketplace`);
  } catch (err) {
    console.error(err);
    res.status(502).json({
      error: `Could not set up this account as a followable strategy: ${err.message || 'unknown error'}`,
    });
  }
});

// The caller's own trader profiles, with milestone progress toward being
// allowed to charge a fee. Success rate requires a MetaApi call per
// profile, so this is only computed here — not in the public marketplace
// listing above, to avoid a slow/expensive call on every visitor's browse.
router.get('/mine', requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT tp.*, ma.metaapi_account_id,
            (SELECT count(*) FROM subscriptions s
              WHERE s.trader_profile_id = tp.id AND s.status = 'active') AS follower_count
     FROM trader_profiles tp
     JOIN mt_accounts ma ON ma.id = tp.mt_account_id
     WHERE ma.user_id = $1`,
    [req.userId]
  );

  const profiles = await Promise.all(
    result.rows.map(async (row) => {
      const successRate = await computeSuccessRate(row.metaapi_account_id);
      const followerCount = Number(row.follower_count);
      const milestonesMet =
        followerCount >= MILESTONE_MIN_FOLLOWERS &&
        successRate !== null &&
        successRate >= MILESTONE_MIN_SUCCESS_RATE;

      return {
        id: row.id,
        headline: row.headline,
        description: row.description,
        followerCount,
        successRate,
        feeEnabled: row.fee_enabled,
        feeCents: row.fee_cents,
        milestonesMet,
        milestones: {
          minFollowers: MILESTONE_MIN_FOLLOWERS,
          minSuccessRate: MILESTONE_MIN_SUCCESS_RATE,
          successRateWindowDays: SUCCESS_RATE_WINDOW_DAYS,
        },
      };
    })
  );

  res.json({ traderProfiles: profiles });
});

// Set (or update) a monthly fee — gated behind the milestones above.
// NOTE: this only records the fee amount and flips fee_enabled on. No
// actual payment collection happens here — wiring this to a real
// processor (Stripe Connect is the common choice, since it handles payouts
// to individual traders) is a separate integration this app doesn't
// include yet, since it requires your own Stripe account and API keys.
router.put('/:id/fee', requireAuth, async (req, res) => {
  const { feeCents } = req.body;

  const result = await pool.query(
    `SELECT tp.*, ma.user_id, ma.metaapi_account_id,
            (SELECT count(*) FROM subscriptions s
              WHERE s.trader_profile_id = tp.id AND s.status = 'active') AS follower_count
     FROM trader_profiles tp
     JOIN mt_accounts ma ON ma.id = tp.mt_account_id
     WHERE tp.id = $1`,
    [req.params.id]
  );
  const profile = result.rows[0];
  if (!profile || profile.user_id !== req.userId) {
    return res.status(404).json({ error: 'Trader profile not found' });
  }

  if (!Number.isInteger(feeCents) || feeCents < 100) {
    return res.status(400).json({ error: 'feeCents must be a whole number of at least 100 (i.e. $1.00)' });
  }

  const followerCount = Number(profile.follower_count);
  if (followerCount < MILESTONE_MIN_FOLLOWERS) {
    return res.status(403).json({
      error: `You need at least ${MILESTONE_MIN_FOLLOWERS} active followers before you can charge a fee (you have ${followerCount})`,
    });
  }

  const successRate = await computeSuccessRate(profile.metaapi_account_id);
  if (successRate === null || successRate < MILESTONE_MIN_SUCCESS_RATE) {
    return res.status(403).json({
      error: `You need at least ${MILESTONE_MIN_SUCCESS_RATE}% success rate over your last ${SUCCESS_RATE_WINDOW_DAYS} days of trades before you can charge a fee${successRate !== null ? ` (you're at ${successRate}%)` : ''}`,
    });
  }

  await pool.query(
    'UPDATE trader_profiles SET fee_enabled = true, fee_cents = $1 WHERE id = $2',
    [feeCents, profile.id]
  );
  res.json({ ok: true });
});

module.exports = router;
