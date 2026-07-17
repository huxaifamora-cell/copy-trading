const { pool } = require('../db');

async function notify(userId, type, message) {
  try {
    await pool.query(
      'INSERT INTO notifications (user_id, type, message) VALUES ($1, $2, $3)',
      [userId, type, message]
    );
  } catch (err) {
    // Notifications are best-effort — never fail the parent action over this.
    console.error('Failed to write notification:', err.message);
  }
}

module.exports = { notify };
