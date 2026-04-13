import { Router } from 'express';
import { getDb } from '../db/database.js';
import { runCalculationPipeline } from '../engine/calculationPipeline.js';
import { v4 as uuid } from 'uuid';

const router = Router();

// Run simulation with overrides
router.post('/run', async (req, res) => {
  const { plan_id, period, created_by, overrides } = req.body;

  try {
    const db = getDb();
    const resolvedOverrides = { ...(overrides || {}) };

    // Convert target_multiplier (percentage) to actual target values per KPI
    if (resolvedOverrides.target_multiplier && resolvedOverrides.target_multiplier !== 100) {
      const planKpis = await db.prepare(`
        SELECT kpi_id, target_value FROM plan_kpis WHERE plan_id = ?
      `).all(plan_id);

      const factor = resolvedOverrides.target_multiplier / 100;
      resolvedOverrides.targets = resolvedOverrides.targets || {};
      for (const pk of planKpis) {
        if (!resolvedOverrides.targets[pk.kpi_id]) {
          resolvedOverrides.targets[pk.kpi_id] = Math.round(pk.target_value * factor * 100) / 100;
        }
      }
    }
    delete resolvedOverrides.target_multiplier;

    const result = await runCalculationPipeline({
      plan_id,
      period,
      created_by,
      is_simulation: true,
      overrides: resolvedOverrides,
    });
    res.json(result);
  } catch (err) {
    console.error('Simulation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Compare two runs
router.get('/compare', async (req, res) => {
  try {
    const db = getDb();
    const { run1, run2 } = req.query;

    const getRunPayouts = async (runId) => {
      return await db.prepare(`
        SELECT ep.employee_id, e.name as employee_name, ep.gross_payout, ep.net_payout,
               ep.multiplier_amount, ep.penalty_amount, ep.cap_adjustment
        FROM employee_payouts ep
        JOIN employees e ON ep.employee_id = e.id
        WHERE ep.run_id = ?
      `).all(runId);
    };

    const payouts1 = await getRunPayouts(run1);
    const payouts2 = await getRunPayouts(run2);

    res.json({ baseline: payouts1, simulation: payouts2 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save simulation snapshot
router.post('/snapshot', async (req, res) => {
  try {
    const db = getDb();
    const id = uuid();
    const { run_id, name, params, results } = req.body;

    await db.prepare(`INSERT INTO simulation_snapshots (id, run_id, name, params, results, created_by)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, run_id, name, JSON.stringify(params), JSON.stringify(results), req.body.created_by);

    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List snapshots
router.get('/snapshots', async (req, res) => {
  try {
    const db = getDb();
    const snapshots = await db.prepare('SELECT * FROM simulation_snapshots ORDER BY created_at DESC').all();
    res.json(snapshots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
