import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const db = getDb();
    let query = 'SELECT * FROM products';
    const params = [];

    if (req.query.category) {
      query += ' WHERE category = ?';
      params.push(req.query.category);
    }

    query += ' ORDER BY category, name';
    const products = await db.prepare(query).all(...params);
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const db = getDb();
    const categories = await db.prepare('SELECT DISTINCT category FROM products ORDER BY category').all();
    res.json(categories.map(c => c.category));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
