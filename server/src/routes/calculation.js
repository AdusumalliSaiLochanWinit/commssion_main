import { Router } from 'express';
import { getDb } from '../db/database.js';
import { runCalculationPipeline } from '../engine/calculationPipeline.js';
import { importTransactions } from '../db/yaumiSync.js';

const router = Router();

// List calculation runs
router.get('/runs', async (req, res) => {
  try {
    const db = getDb();
    let query = `
      SELECT cr.*, cp.name as plan_name
      FROM calculation_runs cr
      JOIN commission_plans cp ON cr.plan_id = cp.id
      WHERE cr.is_simulation = 0
      ORDER BY cr.started_at DESC
    `;
    const runs = await db.prepare(query).all();
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a run with results
router.get('/runs/:id', async (req, res) => {
  try {
    const db = getDb();
    const run = await db.prepare(`
      SELECT cr.*, cp.name as plan_name
      FROM calculation_runs cr
      JOIN commission_plans cp ON cr.plan_id = cp.id
      WHERE cr.id = ?
    `).get(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    run.payouts = await db.prepare(`
      SELECT ep.*, e.name as employee_name, r.name as role_name, e.base_salary
      FROM employee_payouts ep
      JOIN employees e ON ep.employee_id = e.id
      JOIN roles r ON e.role_id = r.id
      WHERE ep.run_id = ?
      ORDER BY ep.net_payout DESC
    `).all(run.id);

    res.json(run);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get payout detail with KPI breakdown
router.get('/payouts/:id', async (req, res) => {
  try {
    const db = getDb();
    const payout = await db.prepare(`
      SELECT ep.*, e.name as employee_name, r.name as role_name, e.base_salary
      FROM employee_payouts ep
      JOIN employees e ON ep.employee_id = e.id
      JOIN roles r ON e.role_id = r.id
      WHERE ep.id = ?
    `).get(req.params.id);
    if (!payout) return res.status(404).json({ error: 'Payout not found' });

    payout.kpi_results = await db.prepare(`
      SELECT kr.*, k.name as kpi_name, k.code as kpi_code, k.category as kpi_category, k.unit
      FROM kpi_results kr
      JOIN kpi_definitions k ON kr.kpi_id = k.id
      WHERE kr.payout_id = ?
    `).all(payout.id);

    payout.approval_history = await db.prepare(`
      SELECT * FROM approval_log WHERE payout_id = ? ORDER BY created_at
    `).all(payout.id);

    res.json(payout);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Import transactions from YOMI for a period
router.post('/import-transactions', async (req, res) => {
  const { period } = req.body;
  if (!period) return res.status(400).json({ error: 'period is required (YYYY-MM)' });

  try {
    const db = getDb();
    const count = await importTransactions(db, period);
    res.json({ success: true, count, period });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Run calculation
router.post('/run', async (req, res) => {
  const { plan_id, period, created_by, employee_id } = req.body;

  try {
    const result = await runCalculationPipeline({ plan_id, period, created_by, is_simulation: false, employee_id });
    res.json(result);
  } catch (err) {
    console.error('Calculation error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
