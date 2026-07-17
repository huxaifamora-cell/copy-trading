const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [req.userId]
  );
  const unreadResult = await pool.query(
    'SELECT count(*) FROM notifications WHERE user_id = $1 AND read = false',
    [req.userId]
  );
  res.json({
    notifications: result.rows,
    unreadCount: Number(unreadResult.rows[0].count),
  });
});

router.post('/read-all', async (req, res) => {
  await pool.query('UPDATE notifications SET read = true WHERE user_id = $1', [req.userId]);
  res.status(204).send();
});

router.post('/:id/read', async (req, res) => {
  await pool.query(
    'UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2',
    [req.params.id, req.userId]
  );
  res.status(204).send();
});

module.exports = router;
