import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const territories = await db.prepare(`
      SELECT t.*, p.name as parent_name
      FROM territories t
      LEFT JOIN territories p ON t.parent_id = p.id
      ORDER BY t.type, t.name
    `).all();
    res.json(territories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
