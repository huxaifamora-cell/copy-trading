/**
 * Wraps MetaApi's CopyFactory module, which does the actual trade
 * replication: it watches a "strategy" account's trades and mirrors them
 * onto every "subscriber" account, scaling position size as configured.
 *
 * Docs: https://metaapi.cloud/docs/copyfactory/
 */
const { CopyFactory } = require('metaapi.cloud-sdk');

const token = process.env.METAAPI_TOKEN;
const copyFactory = new CopyFactory(token);

/**
 * Turns a linked MT account into a followable strategy.
 * @returns {Promise<string>} strategyId
 */
async function createStrategy({ metaapiAccountId, name, description }) {
  const api = copyFactory.configurationApi;
  const strategy = await api.generateStrategyId();

  await api.updateStrategy(strategy.id, {
    name,
    description: description || '',
    accountId: metaapiAccountId,
    // Followers copy proportionally to relative account balance by default;
    // per-subscriber overrides happen at subscription time.
    tradeSizeScaling: { mode: 'balance' },
  });

  return strategy.id;
}

async function deleteStrategy(strategyId) {
  await copyFactory.configurationApi.removeStrategy(strategyId);
}

/**
 * Translates this app's follower-facing risk settings into a CopyFactory
 * subscription config. Only some of what the risk settings UI offers maps
 * onto native CopyFactory fields — see the comments below and
 * services/riskMonitor.js for the rest (max trades/day, max open
 * positions, daily profit target), which CopyFactory has no concept of
 * and which this app enforces itself on a polling basis instead.
 */
function buildSubscriptionPayload(strategyId, riskSettings = {}) {
  const rs = riskSettings || {};
  const lotSizing = rs.lotSizing || { mode: 'mirror' };

  const payload = {
    strategyId,
    skipPendingOrders: false,
  };

  // Lot sizing. CopyFactory's `multiplier` scales the trader's own lot
  // size by a ratio — it has no concept of pinning an absolute fixed lot
  // size regardless of what the trader trades, so "fixed_lot" mode is
  // necessarily an approximation (treated as a multiplier here) rather
  // than a literal fixed size. Flagged in the risk settings UI too.
  switch (lotSizing.mode) {
    case 'multiplier':
    case 'fixed_lot':
      payload.multiplier = Number(lotSizing.multiplier) || 1;
      break;
    case 'balance_scaled':
    case 'mirror':
    default:
      payload.multiplier = 1;
      break;
  }

  // Symbol allow-list
  if (Array.isArray(rs.symbolAllowlist) && rs.symbolAllowlist.length > 0) {
    payload.symbolFilter = { included: rs.symbolAllowlist };
  }

  // Per-trade stop loss cap (pips)
  if (rs.perTradeStopLossPips) {
    payload.maxStopLoss = { value: Number(rs.perTradeStopLossPips), units: 'pips' };
  }

  // Overall max drawdown -> CopyFactory's dedicated stopOutRisk field
  if (rs.maxDrawdownPct) {
    payload.stopOutRisk = {
      relativeValue: Number(rs.maxDrawdownPct) / 100,
      startTime: new Date().toISOString(),
    };
  }

  // Daily max loss -> CopyFactory's riskLimits, keyed on a "day" period
  // with applyTo: "balance-difference" (NOT "type: drawdown" — that's an
  // invalid value and fails validation, a real mistake made and fixed
  // during this project's development)
  if (rs.dailyLossLimitPct) {
    payload.riskLimits = [
      {
        type: 'day',
        applyTo: 'balance-difference',
        maxRelativeRisk: Number(rs.dailyLossLimitPct) / 100,
        closePositions: true,
        startTime: new Date().toISOString(),
      },
    ];
  }

  return payload;
}

/**
 * Subscribes a follower's MT account to a trader's strategy.
 *
 * Preserves any of the follower's OTHER active subscriptions — a naive
 * implementation that just sends `subscriptions: [thisOne]` will silently
 * wipe out subscriptions to any other trader the same account already
 * follows, since CopyFactory's updateSubscriber call replaces the whole
 * array rather than merging into it.
 *
 * @returns {Promise<string>} subscriberId used as the "subscription id"
 */
async function subscribe({ metaapiAccountId, strategyId, riskSettings }) {
  const api = copyFactory.configurationApi;
  const newSubscription = buildSubscriptionPayload(strategyId, riskSettings);

  let existing = null;
  try {
    existing = await api.getSubscriber(metaapiAccountId);
  } catch (err) {
    existing = null; // no subscriber record yet — first time this account follows anyone
  }

  const otherSubscriptions = (existing?.subscriptions || []).filter(
    (s) => s.strategyId !== strategyId
  );

  await api.updateSubscriber(metaapiAccountId, {
    name: existing?.name || `subscriber-${metaapiAccountId}`,
    subscriptions: [...otherSubscriptions, newSubscription],
  });

  return metaapiAccountId;
}

async function unsubscribe(metaapiAccountId, strategyId) {
  const api = copyFactory.configurationApi;
  const subscriber = await api.getSubscriber(metaapiAccountId);
  const remaining = (subscriber.subscriptions || []).filter(
    (s) => s.strategyId !== strategyId
  );
  await api.updateSubscriber(metaapiAccountId, {
    ...subscriber,
    subscriptions: remaining,
  });
}

/** Pulls recent copy performance for a subscriber, for the followers' dashboard. */
async function getSubscriberPerformance(metaapiAccountId) {
  const historyApi = copyFactory.historyApi;
  return historyApi.getSubscriberTrades(metaapiAccountId);
}

module.exports = {
  createStrategy,
  deleteStrategy,
  subscribe,
  unsubscribe,
  getSubscriberPerformance,
};
