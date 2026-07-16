/**
 * Applies schema.sql to the database configured in DATABASE_URL.
 *
 * Runs automatically before every deploy on Render (see the
 * preDeployCommand in render.yaml), so there's no manual "connect to the
 * database and run this file yourself" step. Safe to run repeatedly —
 * schema.sql uses CREATE TABLE/INDEX IF NOT EXISTS, so re-running it on an
 * already-migrated database is a no-op.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function migrate() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set — skipping migration');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  try {
    await pool.query(schema);
    console.log('Database schema is up to date.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
