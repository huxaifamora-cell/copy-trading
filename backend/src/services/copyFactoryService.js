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
      },
    ],
    riskLimits: [
      {
        type: 'drawdown',
        maxRelativeRisk: maxDrawdownPct / 100,
        closePositions: true,                  // auto-stop-copy if breached
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
