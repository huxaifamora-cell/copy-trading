-- Users of the platform (both followers and traders are just "users";
-- a user becomes a "trader" by having a row in trader_profiles)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email verification tokens (also reused for verification resend flow)
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A user's linked MetaTrader account. A user can link more than one,
-- but each account plays exactly one role: it either follows (is a
-- "subscriber" in CopyFactory terms) or it is followed (a "strategy").
CREATE TABLE IF NOT EXISTS mt_accounts (
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
CREATE TABLE IF NOT EXISTS trader_profiles (
  id SERIAL PRIMARY KEY,
  mt_account_id INTEGER NOT NULL UNIQUE REFERENCES mt_accounts(id) ON DELETE CASCADE,
  strategy_id TEXT NOT NULL,             -- CopyFactory strategy id
  headline TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT true,
  fee_enabled BOOLEAN NOT NULL DEFAULT false,
  fee_cents INTEGER,                     -- monthly fee, once milestones are met
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A follow relationship: a follower's mt_account subscribed to a trader's strategy.
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  follower_account_id INTEGER NOT NULL REFERENCES mt_accounts(id) ON DELETE CASCADE,
  trader_profile_id INTEGER NOT NULL REFERENCES trader_profiles(id) ON DELETE CASCADE,
  copyfactory_subscription_id TEXT,
  -- Risk configuration chosen by the follower. Shape (all optional except
  -- lotSizing.mode):
  -- {
  --   "lotSizing": { "mode": "mirror" | "balance_scaled" | "multiplier" | "fixed_lot",
  --                  "multiplier": 1, "fixedLotSize": 0.1 },
  --   "symbolAllowlist": ["EURUSD", "GBPUSD"] | null (null = all symbols),
  --   "maxOpenPositions": 5 | null,
  --   "maxTradesPerDay": 10 | null,
  --   "dailyLossLimitPct": 5 | null,
  --   "dailyProfitTargetPct": 10 | null,
  --   "maxDrawdownPct": 20 | null,
  --   "perTradeStopLossPips": 50 | null
  -- }
  -- "mirror" mode with everything else null means "copy the trader exactly,
  -- using their own risk appetite" per the follower's choice.
  risk_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'stopped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at TIMESTAMPTZ,
  UNIQUE (follower_account_id, trader_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_follower ON subscriptions(follower_account_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_trader ON subscriptions(trader_profile_id);

-- Bookkeeping for risk rules CopyFactory doesn't enforce natively (max
-- trades/day, daily profit target). Reset each day by the risk monitor.
CREATE TABLE IF NOT EXISTS subscription_daily_state (
  subscription_id INTEGER PRIMARY KEY REFERENCES subscriptions(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  trades_count INTEGER NOT NULL DEFAULT 0,
  day_start_balance NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Activity feed: account linked, trader followed/unfollowed, etc.
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
