import { Router } from 'express';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

const router = Router();

// §23 Mid-month territory transfer — records history for accurate commission attribution
router.post('/:id/transfer', async (req, res) => {
  try {
    const db = getDb();
    const { new_territory_id, effective_from, reason } = req.body;
    if (!new_territory_id || !effective_from) {
      return res.status(400).json({ error: 'new_territory_id and effective_from are required' });
    }

    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    // Close the current history record
    await db.prepare(`UPDATE employee_territory_history SET effective_to = ?
      WHERE employee_id = ? AND effective_to IS NULL`).run(effective_from, req.params.id);

    // Open a new history record
    await db.prepare(`INSERT INTO employee_territory_history (id, employee_id, territory_id, effective_from, effective_to, transfer_reason)
      VALUES (?, ?, ?, ?, NULL, ?)`).run(uuid(), req.params.id, new_territory_id, effective_from, reason || 'Transfer');

    // Update current territory on employees table
    await db.prepare('UPDATE employees SET territory_id = ? WHERE id = ?').run(new_territory_id, req.params.id);

    // Audit
    await db.prepare(`INSERT INTO audit_trail (id, entity_type, entity_id, action, changes, performed_by)
      VALUES (?, 'employee', ?, 'transferred', ?, ?)`).run(
      uuid(), req.params.id,
      JSON.stringify({ from: emp.territory_id, to: new_territory_id, effective_from, reason }),
      req.body.performed_by || 'system'
    );

    res.json({ success: true, employee_id: req.params.id, new_territory_id, effective_from });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get territory history for an employee
router.get('/:id/territory-history', async (req, res) => {
  try {
    const db = getDb();
    const history = await db.prepare(`
      SELECT eth.*, t.name as territory_name
      FROM employee_territory_history eth
      LEFT JOIN territories t ON eth.territory_id = t.id
      WHERE eth.employee_id = ?
      ORDER BY eth.effective_from DESC
    `).all(req.params.id);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const employees = await db.prepare(`
      SELECT e.*, r.name as role_name, r.level as role_level,
             t.name as territory_name,
             m.name as manager_name
      FROM employees e
      JOIN roles r ON e.role_id = r.id
      LEFT JOIN territories t ON e.territory_id = t.id
      LEFT JOIN employees m ON e.reports_to = m.id
      ORDER BY r.level DESC, e.name
    `).all();
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/by-external-id/:externalId', async (req, res) => {
  try {
    const db = getDb();
    const employee = await db.prepare(`
      SELECT e.*, r.name as role_name, r.level as role_level,
             t.name as territory_name
      FROM employees e
      JOIN roles r ON e.role_id = r.id
      LEFT JOIN territories t ON e.territory_id = t.id
      WHERE e.external_id = ?
    `).get(req.params.externalId);
    if (!employee) return res.status(404).json({ error: 'Employee not found for external ID' });
    res.json(employee);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const employee = await db.prepare(`
      SELECT e.*, r.name as role_name, r.level as role_level,
             t.name as territory_name,
             m.name as manager_name
      FROM employees e
      JOIN roles r ON e.role_id = r.id
      LEFT JOIN territories t ON e.territory_id = t.id
      LEFT JOIN employees m ON e.reports_to = m.id
      WHERE e.id = ?
    `).get(req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    // Get direct reports
    const reports = await db.prepare(`
      SELECT e.id, e.name, r.name as role_name
      FROM employees e
      JOIN roles r ON e.role_id = r.id
      WHERE e.reports_to = ?
    `).all(req.params.id);

    res.json({ ...employee, direct_reports: reports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/employees/seed-test — create a test employee with commission data for testing
router.post('/seed-test', async (req, res) => {
  try {
    const db = getDb();
    const { external_id, name } = req.body;
    if (!external_id) return res.status(400).json({ error: 'external_id is required' });

    const empId = `emp-${external_id}`;
    const empName = name || `Test Employee ${external_id}`;

    // Ensure role exists
    await db.prepare(
      `INSERT OR IGNORE INTO roles (id, name, level, description, is_field_role) VALUES (?, ?, ?, ?, ?)`
    ).run('role-salesman', 'Salesman', 1, 'Field salesman', 1);

    // Create employee
    await db.prepare(
      `INSERT OR REPLACE INTO employees (id, name, email, external_id, role_id, base_salary, hire_date, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(empId, empName, `${external_id}@choithrams.com`, external_id, 'role-salesman', 5000, '2024-01-01', 1);

    // Create a test commission plan if none exists
    const existingPlan = await db.prepare('SELECT id FROM commission_plans LIMIT 1').get();
    const planId = existingPlan?.id || 'plan-test-001';

    if (!existingPlan) {
      await db.prepare(
        `INSERT INTO commission_plans (id, name, description, status, plan_type, effective_from, effective_to, base_payout)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(planId, 'Test Commission Plan', 'Auto-generated for testing', 'active', 'monthly', '2026-01-01', '2026-12-31', 2000);
    }

    // Create a calculation run for current period
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const runId = `run-test-${external_id}-${period}`;
    const payoutId = `payout-test-${external_id}-${period}`;

    await db.prepare(
      `INSERT OR REPLACE INTO calculation_runs (id, plan_id, period, status, total_payout, employee_count, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(runId, planId, period, 'completed', 1850, 1);

    await db.prepare(
      `INSERT OR REPLACE INTO employee_payouts (id, run_id, employee_id, plan_id, period, gross_payout, multiplier_amount, penalty_amount, cap_adjustment, split_adjustment, net_payout, eligibility_status, approval_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(payoutId, runId, empId, planId, period, 2000, 150, 100, 0, 0, 1850, 'eligible', 'pending');

    // Seed KPI results
    const kpis = [
      { code: 'SALES_TARGET', name: 'Sales Target', target: 100000, actual: 85000, weight: 30 },
      { code: 'TERRITORY_COV', name: 'Territory Coverage', target: 50, actual: 42, weight: 20 },
      { code: 'PRODUCTIVITY', name: 'Sales Productivity', target: 200, actual: 178, weight: 20 },
      { code: 'COLLECTION', name: 'Collection DSO', target: 30, actual: 25, weight: 15 },
      { code: 'DISTRIBUTION', name: 'Distribution MSL', target: 80, actual: 68, weight: 15 },
    ];

    for (let i = 0; i < kpis.length; i++) {
      const kpi = kpis[i];
      const kpiId = `kpi-test-${i + 1}`;
      const achievement = (kpi.actual / kpi.target) * 100;

      // Ensure KPI definition exists
      await db.prepare(
        `INSERT OR IGNORE INTO kpi_definitions (id, name, code, category, description, formula, unit, direction, applicable_roles, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(kpiId, kpi.name, kpi.code, 'Performance', kpi.name, '{}', 'number', 'higher_is_better', '["role-salesman"]', 1);

      await db.prepare(
        `INSERT OR REPLACE INTO kpi_results (id, payout_id, kpi_id, target_value, actual_value, achievement_percent, slab_rate, raw_payout, weighted_payout, weight)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(`kr-${external_id}-${period}-${i}`, payoutId, kpiId, kpi.target, kpi.actual, achievement, 1, 400, 400 * (kpi.weight / 100), kpi.weight);
    }

    res.json({
      message: 'Test data seeded successfully',
      employee_id: empId,
      external_id,
      period,
      payout: 1850,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
