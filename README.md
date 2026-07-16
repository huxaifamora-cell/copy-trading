# Copy Trading Platform — MVP

A working proof-of-concept for a social copy-trading platform: users sign up,
link a MetaTrader 4/5 account with nothing more than login/password/server,
browse a marketplace of "master" traders, and tap **Follow** to automatically
mirror that trader's positions on their own account. No MQL, no VPS, no EAs
to install — all of that is handled server-side.

## How it actually copies trades

Rather than reinvent trade-mirroring from scratch (hard to get right —
partial fills, slippage, reconnects, symbol mapping), this project sits on
top of **MetaApi** (metaapi.cloud) and its **CopyFactory** module, which is
purpose-built for this exact product:

- `metaApiService.js` provisions a cloud-hosted connection to a user's real
  MT4/5 account using only their login, password (or investor password) and
  broker server name — no software installed on the user's side.
- `copyFactoryService.js` turns a linked account into a "strategy" (if the
  user becomes a trader others can follow) or a "subscriber" (if the user
  follows someone), and lets subscribers join/leave a strategy with a
  configurable size scaling ratio. MetaApi's cloud infrastructure does the
  actual trade replication.

This means the "hard part" (reliable, low-latency trade mirroring across
brokers) is delegated to infrastructure designed for it, and this codebase
focuses on the product layer: accounts, marketplace, follow/unfollow,
risk limits, and notifications.

**Note:** MetaApi's APIs evolve — verify exact method signatures against
their current docs (https://metaapi.cloud/docs) before going live. The
service wrappers here are structured to match their general SDK shape but
should be treated as a starting point, not a final integration.

## Project structure

```
backend/
  src/
    server.js                 Express app entry point
    db.js                      Postgres connection pool
    db/schema.sql               Database schema
    middleware/auth.js          JWT auth guard
    routes/auth.js               Signup / login
    routes/accounts.js           Link/unlink MT4/5 accounts
    routes/traders.js            Trader marketplace (become a trader, list traders)
    routes/subscriptions.js      Follow / unfollow a trader
    services/metaApiService.js   MetaApi account provisioning wrapper
    services/copyFactoryService.js  CopyFactory strategy/subscription wrapper
frontend/
  index.html / styles.css / app.js   Single-page dashboard (no build step)
```

## Local setup (Windows cmd)

```cmd
cd backend
npm install
copy .env.example .env
```
Edit `.env` in a text editor and fill in `DATABASE_URL`, `JWT_SECRET`,
`METAAPI_TOKEN`.

```cmd
psql "%DATABASE_URL%" -f src\db\schema.sql
npm run dev
```

Then in a second cmd window:
```cmd
cd frontend
npx serve -l 5173
```
Visit `http://localhost:5173`. It talks to the API at `http://localhost:4000`
by default (see the `API_BASE` fallback at the top of `frontend/index.html`).

## Deploying to Render with the Blueprint

This repo includes a `render.yaml` at the root, so Render can provision the
database, backend, and frontend from one file instead of clicking through
the dashboard for each piece.

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, connect the repo. Render reads
   `render.yaml` and shows you three resources it's about to create:
   `copytrade-db` (Postgres), `copytrade-backend` (web service), and
   `copytrade-frontend` (static site).
3. Render will prompt you for the one variable marked `sync: false` —
   `METAAPI_TOKEN`. Paste your token from metaapi.cloud. Everything else
   (`DATABASE_URL`, `JWT_SECRET`) is wired up or generated automatically.
4. Click **Apply**. Render builds all three.
5. The database schema loads itself automatically — the backend service's
   `preDeployCommand` (`npm run migrate`, see `render.yaml`) runs
   `backend/src/db/migrate.js` before every deploy, which applies
   `schema.sql` to whatever database is wired up via `DATABASE_URL`. There's
   no manual database step: no `psql`, nothing to run from your own
   machine. It's safe to run on every deploy since the schema uses
   `CREATE TABLE IF NOT EXISTS`.
6. Check the actual URLs Render assigned to `copytrade-backend` and
   `copytrade-frontend` — if they differ from the placeholders in
   `render.yaml` (`copytrade-backend.onrender.com` /
   `copytrade-frontend.onrender.com`), update the `CORS_ORIGIN` value on the
   backend service and the `API_BASE` value on the frontend service in the
   Render dashboard, then trigger a redeploy of both.

The frontend is a static site with no server process, so it can't read
environment variables at page-load time. Its `buildCommand` in
`render.yaml` works around this by stamping the `API_BASE` value directly
into `index.html` during the build (replacing the `__API_BASE__`
placeholder) — see the inline script at the top of
`frontend/index.html`.

## What's deliberately out of scope for this MVP

- **Payments/billing** for trader subscription fees or profit-share — bolt on
  Stripe Connect once the core follow/copy loop works.
- **KYC/AML** — required in most jurisdictions before handling real accounts
  at scale; not implemented here.
- **Admin/moderation dashboard** — trader vetting, dispute handling.
- **Production-grade auth hardening** (refresh tokens, rate limiting, email
  verification) — the auth here is intentionally minimal.

## Regulatory note

Running a copy-trading service is regulated to varying degrees depending on
jurisdiction — how you charge fees, whether you touch client money, and how
much discretion followers keep, all affect whether you need a financial
services license. This code deliberately never custodies funds (all trades
happen directly on the user's own broker account) but that alone doesn't
guarantee compliance. Get local legal advice before launching with real
money. Nothing here is financial or legal advice.
