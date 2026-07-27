/**
 * Thin wrapper around the MetaApi SDK. This is the only place in the
 * codebase that talks to MetaApi directly, so if their SDK shape changes
 * you only need to update it here.
 *
 * Docs: https://metaapi.cloud/docs/client/
 */
const MetaApi = require('metaapi.cloud-sdk').default;

const token = process.env.METAAPI_TOKEN;
const metaApi = new MetaApi(token);

/**
 * Provisions a cloud connection to a user's real MT4/5 account so we can
 * read/mirror trades without them installing anything.
 *
 * @param {Object} params
 * @param {string} params.login - MT account number
 * @param {string} params.password - investor password is enough for
 *   read-only followers; the trader whose trades get copied needs a
 *   password with trading rights on their own account (CopyFactory only
 *   needs read access to the master too — it places the mirrored trades
 *   on the follower's account instead).
 * @param {string} params.server - broker server name, e.g. "ICMarkets-Live05"
 * @param {'mt4'|'mt5'} params.platform
 * @returns {Promise<string>} metaapiAccountId
 */
async function provisionAccount({ login, password, server, platform }) {
  const account = await metaApi.metatraderAccountApi.createAccount({
    login,
    password,
    server,
    platform,
    magic: 0,
    name: `acct-${login}`,
    type: 'cloud',
    // Every linked account can follow (subscribe) by default. The
    // PROVIDER role is granted separately, only when the user turns the
    // account into a followable trader (see grantProviderRole below) —
    // CopyFactory rejects strategy creation on accounts missing this flag.
    copyFactoryRoles: ['SUBSCRIBER'],
  });

  // Wait for the terminal connection to come up before we consider the
  // account "linked". In production, do this via webhook/polling with a
  // timeout and surface connection status to the user instead of blocking
  // the HTTP request.
  await account.deploy();
  await account.waitConnected();

  return account.id;
}

/**
 * Grants the CopyFactory PROVIDER role to an already-linked account, so it
 * can be turned into a followable strategy. Required before
 * copyFactoryService.createStrategy will succeed — MetaApi returns
 * "not marked as CopyFactory strategy provider" otherwise.
 *
 * This deliberately bypasses account.update() from the SDK. CopyFactory
 * roles are set through a separate, dedicated endpoint —
 * POST /users/current/accounts/:accountId/enable-account-features — with
 * a nested { copyFactoryApi: { copyFactoryRoles, copyFactoryResourceSlots } }
 * payload, not through the general account update call. Calling
 * account.update({ copyFactoryRoles: [...] }) hits a different endpoint
 * entirely and fails validation, which is what happened during initial
 * development of this feature — see
 * https://metaapi.cloud/docs/provisioning/api/account/enableFeaturesOrApis/
 *
 * NOTE: MetaApi's docs mark this endpoint as a paid option and note the
 * account is briefly stopped/redeployed while the change applies — expect
 * a short delay before the account is usable again after this call.
 */
async function grantProviderRole(metaapiAccountId) {
  const account = await metaApi.metatraderAccountApi.getAccount(metaapiAccountId);
  const currentRoles = account.copyFactoryRoles || [];
  if (currentRoles.includes('PROVIDER')) return;

  const roles = [...new Set([...currentRoles, 'PROVIDER'])];

  const res = await fetch(
    `https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai/users/current/accounts/${metaapiAccountId}/enable-account-features`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'auth-token': token,
      },
      body: JSON.stringify({
        copyFactoryApi: {
          copyFactoryRoles: roles,
          copyFactoryResourceSlots: 1,
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to enable CopyFactory provider role (HTTP ${res.status}): ${body}`);
  }
}

async function removeAccount(metaapiAccountId) {
  const account = await metaApi.metatraderAccountApi.getAccount(metaapiAccountId);
  await account.undeploy();
  await account.remove();
}

/**
 * Fetches live balance/equity/margin for a linked account, plus recent
 * closed trades, in a single connection. Used to power the account
 * details view in the dashboard.
 *
 * @param {string} metaapiAccountId
 * @param {number} historyDays - how far back to pull closed trades
 */
async function getAccountSnapshot(metaapiAccountId, historyDays = 30) {
  const account = await metaApi.metatraderAccountApi.getAccount(metaapiAccountId);
  const connection = account.getRPCConnection();
  await connection.connect();
  await connection.waitSynchronized();

  const info = await connection.getAccountInformation();

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - historyDays * 24 * 60 * 60 * 1000);
  const deals = await connection.getDealsByTimeRange(startTime, endTime);
  const positions = await connection.getPositions();

  // Deals include balance operations (deposits/withdrawals) as well as
  // actual trade fills — keep only closed trade fills for the history view.
  const trades = (deals.deals || deals || [])
    .filter((d) => d.entryType === 'DEAL_ENTRY_OUT' || d.entryType === 'DEAL_ENTRY_OUT_BY')
    .map((d) => ({
      time: d.time,
      symbol: d.symbol,
      type: d.type,
      volume: d.volume,
      price: d.price,
      profit: d.profit,
      commission: d.commission,
      swap: d.swap,
    }))
    .sort((a, b) => new Date(b.time) - new Date(a.time));

  return {
    balance: info.balance,
    equity: info.equity,
    margin: info.margin,
    freeMargin: info.freeMargin,
    currency: info.currency,
    leverage: info.leverage,
    openPositionsCount: (positions || []).length,
    trades,
  };
}

module.exports = { provisionAccount, removeAccount, getAccountSnapshot, grantProviderRole };
