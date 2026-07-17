/**
 * Applies schema.sql to the database configured in DATABASE_URL.
 *
 * Exported as a function so server.js can run it automatically on boot
 * (see server.js) — this avoids depending on Render's Pre-Deploy Command
 * field, which is locked/uneditable on Blueprint-managed services on some
 * plans. It's also still runnable standalone: `npm run migrate`.
 *
 * Safe to run repeatedly — schema.sql uses CREATE TABLE/INDEX IF NOT
 * EXISTS, so re-running it on an already-migrated database is a no-op.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function applyMigrations(pool) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(schema);
}

// Allow `node src/db/migrate.js` / `npm run migrate` to still work standalone
if (require.main === module) {
  (async () => {
    if (!process.env.DATABASE_URL) {
      console.error('DATABASE_URL is not set — skipping migration');
      process.exit(1);
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      await applyMigrations(pool);
      console.log('Database schema is up to date.');
    } catch (err) {
      console.error('Migration failed:', err.message);
      process.exit(1);
    } finally {
      await pool.end();
    }
  })();
}

module.exports = { applyMigrations };
