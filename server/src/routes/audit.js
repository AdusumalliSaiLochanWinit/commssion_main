import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { entity_type, entity_id, limit = 100 } = req.query;

    let query = 'SELECT * FROM audit_trail';
    const conditions = [];
    const params = [];

    if (entity_type) {
      conditions.push('entity_type = ?');
      params.push(entity_type);
    }
    if (entity_id) {
      conditions.push('entity_id = ?');
      params.push(entity_id);
    }

    if (conditions.length) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY performed_at DESC LIMIT ?';
    params.push(Number(limit));

    const entries = await db.prepare(query).all(...params);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
