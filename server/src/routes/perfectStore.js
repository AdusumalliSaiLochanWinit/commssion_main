import { Router } from 'express';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

const router = Router();

// List all audits (optionally filter by employee, period)
router.get('/audits', async (req, res) => {
  try {
    const db = getDb();
    const { employee_id, period, customer_id } = req.query;
    let sql = `SELECT ps.*, e.name as employee_name, c.name as customer_name
               FROM perfect_store_audits ps
               LEFT JOIN employees e ON ps.employee_id = e.id
               LEFT JOIN customers c ON ps.customer_id = c.id
               WHERE 1=1`;
    const args = [];
    if (employee_id) { sql += ' AND ps.employee_id = ?'; args.push(employee_id); }
    if (period) { sql += ' AND ps.period = ?'; args.push(period); }
    if (customer_id) { sql += ' AND ps.customer_id = ?'; args.push(customer_id); }
    sql += ' ORDER BY ps.audited_at DESC';
    const audits = await db.prepare(sql).all(...args);
    res.json(audits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Per-employee summary: average composite score
router.get('/summary', async (req, res) => {
  try {
    const db = getDb();
    const { period } = req.query;
    const rows = await db.prepare(`
      SELECT ps.employee_id, e.name as employee_name,
             COUNT(*) as audit_count,
             ROUND(AVG(ps.composite_score), 2) as avg_composite,
             ROUND(AVG(ps.assortment_score), 2) as avg_assortment,
             ROUND(AVG(ps.pricing_score), 2) as avg_pricing,
             ROUND(AVG(ps.shelf_share_score), 2) as avg_shelf_share,
             ROUND(AVG(ps.promotion_score), 2) as avg_promotion,
             ROUND(AVG(ps.visibility_score), 2) as avg_visibility,
             ROUND(AVG(ps.cleanliness_score), 2) as avg_cleanliness,
             ROUND(AVG(ps.stock_availability_score), 2) as avg_stock
      FROM perfect_store_audits ps
      LEFT JOIN employees e ON ps.employee_id = e.id
      WHERE ps.period = COALESCE(?, ps.period)
      GROUP BY ps.employee_id, e.name
      ORDER BY avg_composite DESC
    `).all(period || null);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new audit (supports manual audit or field-tool integration)
router.post('/audits', async (req, res) => {
  try {
    const db = getDb();
    const {
      employee_id, customer_id, period,
      assortment_score, pricing_score, shelf_share_score, promotion_score,
      visibility_score, cleanliness_score, stock_availability_score,
      audited_by,
    } = req.body;

    if (!employee_id || !customer_id || !period) {
      return res.status(400).json({ error: 'employee_id, customer_id, period required' });
    }

    // Load weights (plan-specific or default)
    const weights = await db.prepare('SELECT * FROM perfect_store_weights WHERE plan_id IS NULL LIMIT 1').get()
      || { assortment_weight: 20, pricing_weight: 15, shelf_share_weight: 15, promotion_weight: 15, visibility_weight: 15, cleanliness_weight: 10, stock_availability_weight: 10 };

    const totalWeight = weights.assortment_weight + weights.pricing_weight + weights.shelf_share_weight
      + weights.promotion_weight + weights.visibility_weight + weights.cleanliness_weight + weights.stock_availability_weight;

    const composite = (
      (assortment_score || 0) * weights.assortment_weight +
      (pricing_score || 0) * weights.pricing_weight +
      (shelf_share_score || 0) * weights.shelf_share_weight +
      (promotion_score || 0) * weights.promotion_weight +
      (visibility_score || 0) * weights.visibility_weight +
      (cleanliness_score || 0) * weights.cleanliness_weight +
      (stock_availability_score || 0) * weights.stock_availability_weight
    ) / totalWeight;

    const id = uuid();
    await db.prepare(`INSERT INTO perfect_store_audits
      (id, employee_id, customer_id, period, assortment_score, pricing_score, shelf_share_score,
       promotion_score, visibility_score, cleanliness_score, stock_availability_score, composite_score, audited_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, employee_id, customer_id, period,
      assortment_score || 0, pricing_score || 0, shelf_share_score || 0,
      promotion_score || 0, visibility_score || 0, cleanliness_score || 0, stock_availability_score || 0,
      Math.round(composite * 100) / 100, audited_by || 'manual'
    );

    res.status(201).json({ id, composite_score: Math.round(composite * 100) / 100 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get weights config
router.get('/weights/:planId?', async (req, res) => {
  try {
    const db = getDb();
    const planId = req.params.planId;
    const weights = planId
      ? await db.prepare('SELECT * FROM perfect_store_weights WHERE plan_id = ?').get(planId)
      : await db.prepare('SELECT * FROM perfect_store_weights WHERE plan_id IS NULL LIMIT 1').get();
    res.json(weights || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update weights (weights can be plan-specific or global default)
router.put('/weights', async (req, res) => {
  try {
    const db = getDb();
    const { plan_id, assortment_weight, pricing_weight, shelf_share_weight, promotion_weight, visibility_weight, cleanliness_weight, stock_availability_weight } = req.body;

    const existing = plan_id
      ? await db.prepare('SELECT id FROM perfect_store_weights WHERE plan_id = ?').get(plan_id)
      : await db.prepare('SELECT id FROM perfect_store_weights WHERE plan_id IS NULL').get();

    if (existing) {
      await db.prepare(`UPDATE perfect_store_weights SET
        assortment_weight = ?, pricing_weight = ?, shelf_share_weight = ?,
        promotion_weight = ?, visibility_weight = ?, cleanliness_weight = ?, stock_availability_weight = ?
        WHERE id = ?`).run(
        assortment_weight, pricing_weight, shelf_share_weight, promotion_weight,
        visibility_weight, cleanliness_weight, stock_availability_weight, existing.id
      );
    } else {
      await db.prepare(`INSERT INTO perfect_store_weights (id, plan_id, assortment_weight, pricing_weight, shelf_share_weight, promotion_weight, visibility_weight, cleanliness_weight, stock_availability_weight)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        uuid(), plan_id || null, assortment_weight, pricing_weight, shelf_share_weight,
        promotion_weight, visibility_weight, cleanliness_weight, stock_availability_weight
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
