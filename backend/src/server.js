require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { pool } = require('./db');
const { applyMigrations } = require('./db/migrate');
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const traderRoutes = require('./routes/traders');
const subscriptionRoutes = require('./routes/subscriptions');

const app = express();

app.use(cors({ origin: (process.env.CORS_ORIGIN || '*').split(',') }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/traders', traderRoutes);
app.use('/api/subscriptions', subscriptionRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error' });
});

const port = process.env.PORT || 4000;

// Apply the schema on every boot before accepting traffic. This is what
// keeps the database up to date without needing Render's Pre-Deploy
// Command field (which can be locked on Blueprint-managed services) —
// it just runs as part of normal app startup instead.
(async () => {
  try {
    await applyMigrations(pool);
    console.log('Database schema is up to date.');
  } catch (err) {
    console.error('Failed to apply database migrations:', err.message);
    process.exit(1);
  }

  app.listen(port, () => console.log(`Copy trading API listening on :${port}`));
})();
