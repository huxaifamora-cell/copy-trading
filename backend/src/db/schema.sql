-- Users of the platform (both followers and traders are just "users";
-- a user becomes a "trader" by having a row in trader_profiles)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A user's linked MetaTrader account. A user can link more than one,
-- but each account plays exactly one role: it either follows (is a
-- "subscriber" in CopyFactory terms) or it is followed (a "strategy").
CREATE TABLE mt_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker_server TEXT NOT NULL,
  mt_login TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('mt4', 'mt5')),
  metaapi_account_id TEXT NOT NULL,      -- id returned by MetaApi after provisioning
  copyfactory_account_id TEXT,           -- id after registering with CopyFactory
  role TEXT NOT NULL DEFAULT 'follower' CHECK (role IN ('follower', 'trader')),
  nickname TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, broker_server, mt_login)
);

-- Public profile for an mt_account acting as a master strategy.
CREATE TABLE trader_profiles (
  id SERIAL PRIMARY KEY,
  mt_account_id INTEGER NOT NULL UNIQUE REFERENCES mt_accounts(id) ON DELETE CASCADE,
  strategy_id TEXT NOT NULL,             -- CopyFactory strategy id
  headline TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A follow relationship: a follower's mt_account subscribed to a trader's strategy.
CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  follower_account_id INTEGER NOT NULL REFERENCES mt_accounts(id) ON DELETE CASCADE,
  trader_profile_id INTEGER NOT NULL REFERENCES trader_profiles(id) ON DELETE CASCADE,
  copyfactory_subscription_id TEXT,
  size_scaling NUMERIC NOT NULL DEFAULT 1.0,  -- e.g. 0.5 = copy at half size
  max_drawdown_pct NUMERIC NOT NULL DEFAULT 20,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at TIMESTAMPTZ,
  UNIQUE (follower_account_id, trader_profile_id)
);

CREATE INDEX idx_subscriptions_follower ON subscriptions(follower_account_id);
CREATE INDEX idx_subscriptions_trader ON subscriptions(trader_profile_id);
