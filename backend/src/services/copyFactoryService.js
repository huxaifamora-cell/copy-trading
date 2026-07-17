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
 * Subscribes a follower's MT account to a trader's strategy.
 *
 * Uses CopyFactory's `stopOutRisk` field (not `riskLimits`) to express a
 * simple max-drawdown auto-stop — riskLimits is a different, more general
 * mechanism keyed on a time period (day/week/month/... — not "drawdown")
 * plus an `applyTo` metric selector, and sending `type: 'drawdown'` there
 * fails validation. stopOutRisk is CopyFactory's dedicated field for
 * "pause copying once relative loss exceeds X%", which is exactly what
 * maxDrawdownPct means in this app. See:
 * https://metaapi.cloud/docs/copyfactory/models/strategySubscription/
 *
 * @returns {Promise<string>} subscriberId used as the "subscription id"
 */
async function subscribe({ metaapiAccountId, strategyId, sizeScaling, maxDrawdownPct }) {
  const api = copyFactory.configurationApi;

  await api.updateSubscriber(metaapiAccountId, {
    name: `subscriber-${metaapiAccountId}`,
    subscriptions: [
      {
        strategyId,
        multiplier: sizeScaling,               // e.g. 0.5 = copy at half size
        skipPendingOrders: false,
        stopOutRisk: {
          relativeValue: maxDrawdownPct / 100,  // e.g. 20 -> 0.2 (20% drawdown)
          startTime: new Date().toISOString(),
        },
      },
    ],
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
