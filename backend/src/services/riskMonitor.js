/**
 * Lightweight custom enforcement for risk rules CopyFactory doesn't
 * support natively: max open positions, max trades per day, and a daily
 * profit-target auto-stop. CopyFactory only understands loss-side limits
 * (stopOutRisk, riskLimits) — it has no concept of a trade-count cap or a
 * "stop once you've made enough today" rule, so this app enforces those
 * itself on a polling basis.
 *
 * IMPORTANT CAVEAT: this runs on a plain setInterval inside the same
 * process as the API server. That's fine at small scale, but it means
 * enforcement has multi-minute latency (not instant, unlike CopyFactory's
 * own native limits) and competes with request handling for the same
 * process's resources. If this platform grows, move this to a separate
 * worker process on its own schedule instead.
 */
const { pool } = require('../db');
const metaApiService = require('./metaApiService');
const copyFactoryService = require('./copyFactoryService');
const { notify } = require('./notify');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function checkSubscription(sub) {
  const rs = sub.risk_settings || {};
  const hasCustomRules = rs.maxOpenPositions || rs.maxTradesPerDay || rs.dailyProfitTargetPct;
  if (!hasCustomRules) return;

  const today = new Date().toISOString().slice(0, 10);

  const stateResult = await pool.query(
    'SELECT * FROM subscription_daily_state WHERE subscription_id = $1',
    [sub.id]
  );
  let state = stateResult.rows[0];

  const snapshot = await metaApiService.getAccountSnapshot(sub.metaapi_account_id, 1);

  if (!state || state.day.toISOString().slice(0, 10) !== today) {
    await pool.query(
      `INSERT INTO subscription_daily_state (subscription_id, day, trades_count, day_start_balance)
       VALUES ($1, $2, 0, $3)
       ON CONFLICT (subscription_id)
       DO UPDATE SET day = $2, trades_count = 0, day_start_balance = $3, updated_at = now()`,
      [sub.id, today, snapshot.balance]
    );
    state = { day_start_balance: snapshot.balance };
  }

  const tradesToday = snapshot.trades.filter((t) => t.time && t.time.slice(0, 10) === today).length;

  let breachReason = null;

  if (rs.maxOpenPositions && snapshot.openPositionsCount > rs.maxOpenPositions) {
    breachReason = `Exceeded your max open positions limit (${rs.maxOpenPositions})`;
  }

  if (!breachReason && rs.maxTradesPerDay && tradesToday >= rs.maxTradesPerDay) {
    breachReason = `Reached your max trades per day limit (${rs.maxTradesPerDay})`;
  }

  if (!breachReason && rs.dailyProfitTargetPct && state.day_start_balance) {
    const gainPct = ((snapshot.balance - state.day_start_balance) / state.day_start_balance) * 100;
    if (gainPct >= rs.dailyProfitTargetPct) {
      breachReason = `Hit your daily profit target (+${rs.dailyProfitTargetPct}%) — paused copying for today`;
    }
  }

  await pool.query(
    'UPDATE subscription_daily_state SET trades_count = $1, updated_at = now() WHERE subscription_id = $2',
    [tradesToday, sub.id]
  );

  if (breachReason) {
    await copyFactoryService.unsubscribe(sub.metaapi_account_id, sub.strategy_id);
    await pool.query("UPDATE subscriptions SET status = 'paused', stopped_at = now() WHERE id = $1", [sub.id]);
    await notify(sub.user_id, 'risk_limit_hit', breachReason);
  }
}

async function runRiskChecks() {
  const result = await pool.query(`
    SELECT s.*, ma.metaapi_account_id, ma.user_id, tp.strategy_id
    FROM subscriptions s
    JOIN mt_accounts ma ON ma.id = s.follower_account_id
    JOIN trader_profiles tp ON tp.id = s.trader_profile_id
    WHERE s.status = 'active'
  `);

  for (const sub of result.rows) {
    try {
      await checkSubscription(sub);
    } catch (err) {
      console.error(`Risk check failed for subscription ${sub.id}:`, err.message);
    }
  }
}

function startRiskMonitor() {
  runRiskChecks().catch((err) => console.error('Initial risk check failed:', err.message));
  setInterval(() => {
    runRiskChecks().catch((err) => console.error('Risk check failed:', err.message));
  }, POLL_INTERVAL_MS);
}

module.exports = { startRiskMonitor };
