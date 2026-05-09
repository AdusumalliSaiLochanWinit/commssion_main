import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { period, employee_id, limit } = req.query;

    const params = [];
    let sql = `
      SELECT t.*,
        e.name AS employee_name,
        c.name AS customer_name,
        p.name AS product_name,
        p.sku AS product_sku
      FROM transactions t
      JOIN employees e ON e.id = t.employee_id
      JOIN customers c ON c.id = t.customer_id
      JOIN products p ON p.id = t.product_id
      WHERE 1=1
    `;

    if (period) {
      sql += ' AND t.period = ?';
      params.push(period);
    }
    if (employee_id) {
      sql += ' AND t.employee_id = ?';
      params.push(employee_id);
    }

    sql += ' ORDER BY t.transaction_date DESC';

    const lim = Math.max(1, Math.min(1000, Number(limit || 200)));
    sql += ' LIMIT ?';
    params.push(lim);

    const rows = await db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

