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
 * NOTE: MetaApi's account.update() appears to validate against the full
 * editable account payload rather than merging in a single changed field,
 * so this re-sends the account's current name/magic/tags alongside the
 * new copyFactoryRoles rather than sending copyFactoryRoles alone. If you
 * hit a "Validation failed" error here, check the current
 * UpdatedMetatraderAccountDto shape at https://metaapi.cloud/docs/client/
 * — this is exactly the kind of SDK drift flagged in the README.
 */
async function grantProviderRole(metaapiAccountId) {
  const account = await metaApi.metatraderAccountApi.getAccount(metaapiAccountId);
  const currentRoles = account.copyFactoryRoles || [];
  if (currentRoles.includes('PROVIDER')) return;

  try {
    await account.update({
      name: account.name,
      magic: account.magic,
      quoteStreamingIntervalInSeconds: account.quoteStreamingIntervalInSeconds,
      tags: account.tags || [],
      copyFactoryRoles: [...currentRoles, 'PROVIDER'],
    });
  } catch (err) {
    // MetaApi's error objects often have useful info outside `message` —
    // log everything so a "Validation failed" isn't a dead end next time.
    console.error('grantProviderRole failed. Full error:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
    throw err;
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
    trades,
  };
}

module.exports = { provisionAccount, removeAccount, getAccountSnapshot, grantProviderRole };
