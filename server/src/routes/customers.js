import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const db = getDb();
    let query = `
      SELECT c.*, t.name as territory_name
      FROM customers c
      LEFT JOIN territories t ON c.territory_id = t.id
    `;
    const params = [];

    if (req.query.channel) {
      query += ' WHERE c.channel = ?';
      params.push(req.query.channel);
    }

    query += ' ORDER BY c.channel, c.name';
    const customers = await db.prepare(query).all(...params);
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
