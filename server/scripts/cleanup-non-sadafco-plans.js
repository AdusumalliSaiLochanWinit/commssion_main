// Deletes ALL plans except the 8 SADAFCO KSA 25 plans.
// Handles cascading deletes for: kpi_results, approval_log, employee_payouts,
// simulation_snapshots, calculation_runs, plus FK-cascading plan children.
//
// Usage:
//   DATABASE_URL='postgres://...' node scripts/cleanup-non-sadafco-plans.js
//   (or auto-resolves from ../.env.production / ../.env)

import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  for (const f of [path.join(__dirname,'..','..','.env.production'), path.join(__dirname,'..','.env')]) {
    if (existsSync(f)) {
      const m = readFileSync(f, 'utf8').match(/DATABASE_URL=\"?([^\"\n]+)/);
      if (m) { DATABASE_URL = m[1]; break; }
    }
  }
}
if (!DATABASE_URL) throw new Error('DATABASE_URL not found');

const KEEP_IDS = [
  'plan-sadafco-amb-tt-mm',
  'plan-sadafco-amb-ws-mt',
  'plan-sadafco-amb-ooh',
  'plan-sadafco-frz-tt-mm',
  'plan-sadafco-frz-mt-ooh',
  'plan-sadafco-sup-amb',
  'plan-sadafco-sup-frz',
  'plan-sadafco-sup-ooh',
];

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false });
  const c = await pool.connect();
  try {
    const before = await c.query('SELECT id, name FROM commission_plans WHERE id != ALL($1) ORDER BY name', [KEEP_IDS]);
    console.log('Plans to DELETE (' + before.rows.length + '):');
    before.rows.forEach(r => console.log('  - ' + r.name + '  [' + r.id + ']'));
    console.log('\nPlans to KEEP (' + KEEP_IDS.length + '): the 8 SADAFCO segments');

    await c.query('BEGIN');

    // 1. kpi_results (depends on employee_payouts)
    const r1 = await c.query(`DELETE FROM kpi_results WHERE payout_id IN (SELECT id FROM employee_payouts WHERE plan_id != ALL($1))`, [KEEP_IDS]);
    console.log('\n  kpi_results deleted:', r1.rowCount);

    // 2. approval_log (depends on employee_payouts)
    const r2 = await c.query(`DELETE FROM approval_log WHERE payout_id IN (SELECT id FROM employee_payouts WHERE plan_id != ALL($1))`, [KEEP_IDS]);
    console.log('  approval_log deleted:', r2.rowCount);

    // 3. employee_payouts (depends on plan)
    const r3 = await c.query(`DELETE FROM employee_payouts WHERE plan_id != ALL($1)`, [KEEP_IDS]);
    console.log('  employee_payouts deleted:', r3.rowCount);

    // 4. simulation_snapshots (depends on calculation_runs)
    const r4 = await c.query(`DELETE FROM simulation_snapshots WHERE run_id IN (SELECT id FROM calculation_runs WHERE plan_id != ALL($1))`, [KEEP_IDS]);
    console.log('  simulation_snapshots deleted:', r4.rowCount);

    // 5. calculation_runs
    const r5 = await c.query(`DELETE FROM calculation_runs WHERE plan_id != ALL($1)`, [KEEP_IDS]);
    console.log('  calculation_runs deleted:', r5.rowCount);

    // 6. Finally, delete the plans (CASCADE handles plan_kpis, plan_roles, plan_territories,
    //    slab_sets, slab_tiers, rule_sets, rules, eligibility_rules, multiplier_rules,
    //    penalty_rules, capping_rules, split_rules, split_participants, kpi_deduction_rules,
    //    plan_kpi_monthly_targets, plan_fixed_incentives, perfect_store_weights, helper_trip_rates)
    const r6 = await c.query(`DELETE FROM commission_plans WHERE id != ALL($1)`, [KEEP_IDS]);
    console.log('  commission_plans deleted:', r6.rowCount);

    await c.query('COMMIT');

    const after = await c.query('SELECT id, name, status FROM commission_plans ORDER BY name');
    console.log('\nRemaining plans (' + after.rows.length + '):');
    after.rows.forEach(r => console.log('  ✓ ' + r.name + '  [' + r.status + ']'));
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('FAILED:', e.message);
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
