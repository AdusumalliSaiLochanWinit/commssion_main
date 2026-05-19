// One-shot: assign active employees to SADAFCO segment roles (snapshot first),
// run the calculation pipeline for plan-sadafco-ksa-25-sm, dump results.
// Safe to re-run: snapshot is idempotent (only restores from snapshot if present, never overwrites).

import pg from 'pg';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { runCalculationPipeline } from '../src/engine/calculationPipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });

const PLAN_ID = 'plan-sadafco-ksa-25-sm';
const PERIOD = '2026-05';

const ASSIGNMENTS = [
  { emp: 'emp-001', role: 'role-amb-tt-mm-sm',   label: 'Ahmed Hassan      → AMB TT/MM' },
  { emp: 'emp-002', role: 'role-amb-ws-mt-pre',  label: 'Mohammed Ali      → AMB WS/MT' },
  { emp: 'emp-003', role: 'role-amb-ooh-sm',     label: 'Khalid Omar       → AMB OOH'   },
  { emp: 'emp-004', role: 'role-frz-tt-mm-sm',   label: 'Fatima Zahra      → FRZ TT/MM' },
  { emp: 'emp-005', role: 'role-frz-mt-ooh-sm',  label: 'Saeed Al Maktoum  → FRZ MT/OOH'},
  { emp: 'emp-006', role: 'role-amb-tt-mm-sm',   label: 'Rashid Noor       → AMB TT/MM' },
];

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    // Snapshot original role assignments (only if not already snapshotted)
    await c.query(`CREATE TABLE IF NOT EXISTS sadafco_role_snapshot (
      employee_id TEXT PRIMARY KEY,
      original_role_id TEXT NOT NULL,
      snapshotted_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
    for (const a of ASSIGNMENTS) {
      const cur = await c.query('SELECT role_id FROM employees WHERE id = $1', [a.emp]);
      if (cur.rows.length === 0) { console.log('skip', a.emp, '(missing)'); continue; }
      await c.query(
        `INSERT INTO sadafco_role_snapshot (employee_id, original_role_id) VALUES ($1, $2) ON CONFLICT (employee_id) DO NOTHING`,
        [a.emp, cur.rows[0].role_id]
      );
      await c.query('UPDATE employees SET role_id = $1 WHERE id = $2', [a.role, a.emp]);
      console.log('  ', a.label, '(was', cur.rows[0].role_id + ')');
    }
  } finally {
    c.release();
    await pool.end();
  }

  console.log('\n=== Running pipeline ===');
  console.log('Plan:  ', PLAN_ID);
  console.log('Period:', PERIOD);
  console.log('');
  const result = await runCalculationPipeline({
    plan_id: PLAN_ID,
    period: PERIOD,
    created_by: 'sadafco-test',
    is_simulation: false,
  });

  console.log('\n=== Pipeline result ===');
  console.log('Run ID:', result.runId);
  console.log('Total payout:', result.totalPayout);
  console.log('Employees processed:', result.employees?.length || 0);
  console.log('Message:', result.message || '(ok)');

  // Dump per-employee + KPI breakdown
  const pool2 = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const payouts = await pool2.query(`
      SELECT ep.id, e.name, e.role_id, ep.gross_payout, ep.kpi_deduction_amount, ep.net_payout, ep.eligibility_status
      FROM employee_payouts ep
      JOIN employees e ON e.id = ep.employee_id
      WHERE ep.run_id = $1
      ORDER BY ep.net_payout DESC
    `, [result.runId]);

    console.log('\n--- PAYOUTS ---');
    for (const p of payouts.rows) {
      console.log(`\n${p.name}  [${p.role_id}]`);
      console.log(`  Gross: SAR ${Number(p.gross_payout).toFixed(2)} | Deductions: SAR ${Number(p.kpi_deduction_amount).toFixed(2)} | Net: SAR ${Number(p.net_payout).toFixed(2)} | Status: ${p.eligibility_status}`);
      const kr = await pool2.query(`
        SELECT k.code, k.name, kr.actual_value, kr.target_value, kr.achievement_percent, kr.slab_rate, kr.raw_payout, kr.weight, kr.weighted_payout
        FROM kpi_results kr
        JOIN kpi_definitions k ON k.id = kr.kpi_id
        WHERE kr.payout_id = $1
        ORDER BY kr.weight DESC, k.code
      `, [p.id]);
      for (const r of kr.rows) {
        console.log(`    ${r.code.padEnd(22)} actual=${Number(r.actual_value).toFixed(1)} target=${Number(r.target_value).toFixed(1)} ach=${Number(r.achievement_percent).toFixed(1)}% slab_rate=${Number(r.slab_rate).toFixed(2)} raw=SAR ${Number(r.raw_payout).toFixed(2)} w=${r.weight} weighted=SAR ${Number(r.weighted_payout).toFixed(2)}`);
      }
    }
  } finally {
    await pool2.end();
  }
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
