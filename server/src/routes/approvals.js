import { Router } from 'express';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

const router = Router();

// Get pending approvals by stage
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { status } = req.query;

    let query = `
      SELECT ep.*, e.name as employee_name, r.name as role_name, e.base_salary,
             cp.name as plan_name, cr.period
      FROM employee_payouts ep
      JOIN employees e ON ep.employee_id = e.id
      JOIN roles r ON e.role_id = r.id
      JOIN commission_plans cp ON ep.plan_id = cp.id
      JOIN calculation_runs cr ON ep.run_id = cr.id
      WHERE cr.is_simulation = 0
    `;

    if (status) {
      query += ` AND ep.approval_status = ?`;
    }

    query += ' ORDER BY ep.net_payout DESC';

    const payouts = status
      ? await db.prepare(query).all(status)
      : await db.prepare(query).all();

    res.json(payouts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve/reject a payout
router.post('/:payoutId/action', async (req, res) => {
  try {
    const db = getDb();
    const { action, acted_by, acted_by_role, comments } = req.body;
    const { payoutId } = req.params;

    const payout = await db.prepare('SELECT * FROM employee_payouts WHERE id = ?').get(payoutId);
    if (!payout) return res.status(404).json({ error: 'Payout not found' });

    // Validate action sequence
    const validTransitions = {
      submitted: ['manager_approved', 'rejected'],
      manager_approved: ['finance_approved', 'rejected'],
      finance_approved: ['hr_approved', 'rejected'],
      hr_approved: ['locked'],
    };

    const allowed = validTransitions[payout.approval_status];
    if (!allowed || !allowed.includes(action)) {
      return res.status(400).json({
        error: `Cannot transition from ${payout.approval_status} to ${action}`
      });
    }

    // Rejection requires comments
    if (action === 'rejected' && !comments) {
      return res.status(400).json({ error: 'Rejection requires comments' });
    }

    // Update payout status
    await db.prepare('UPDATE employee_payouts SET approval_status = ? WHERE id = ?').run(action, payoutId);

    // Log approval
    await db.prepare(`INSERT INTO approval_log (id, payout_id, action, acted_by, acted_by_role, comments)
      VALUES (?, ?, ?, ?, ?, ?)`).run(uuid(), payoutId, action, acted_by, acted_by_role, comments);

    // If locked, check if all payouts in the run are locked
    if (action === 'locked') {
      const run = await db.prepare('SELECT run_id FROM employee_payouts WHERE id = ?').get(payoutId);
      const unlocked = await db.prepare(`SELECT COUNT(*) as count FROM employee_payouts WHERE run_id = ? AND approval_status != 'locked'`).get(run.run_id);
      if (unlocked.count === 0) {
        await db.prepare("UPDATE calculation_runs SET status = 'locked' WHERE id = ?").run(run.run_id);
      }
    }

    // Audit trail
    await db.prepare(`INSERT INTO audit_trail (id, entity_type, entity_id, action, changes, performed_by)
      VALUES (?, 'payout', ?, ?, ?, ?)`).run(uuid(), payoutId, action, JSON.stringify({ from: payout.approval_status, to: action, comments }), acted_by);

    const updated = await db.prepare('SELECT * FROM employee_payouts WHERE id = ?').get(payoutId);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk approve
router.post('/bulk-action', async (req, res) => {
  try {
    const db = getDb();
    const { payout_ids, action, acted_by, acted_by_role, comments } = req.body;

    const results = [];
    for (const payoutId of payout_ids) {
      const payout = await db.prepare('SELECT * FROM employee_payouts WHERE id = ?').get(payoutId);
      if (!payout) continue;

      const validTransitions = {
        submitted: ['manager_approved', 'rejected'],
        manager_approved: ['finance_approved', 'rejected'],
        finance_approved: ['hr_approved', 'rejected'],
        hr_approved: ['locked'],
      };

      const allowed = validTransitions[payout.approval_status];
      if (!allowed || !allowed.includes(action)) continue;

      await db.prepare('UPDATE employee_payouts SET approval_status = ? WHERE id = ?').run(action, payoutId);
      await db.prepare(`INSERT INTO approval_log (id, payout_id, action, acted_by, acted_by_role, comments)
        VALUES (?, ?, ?, ?, ?, ?)`).run(uuid(), payoutId, action, acted_by, acted_by_role, comments);

      results.push(payoutId);
    }

    res.json({ updated: results.length, payout_ids: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
