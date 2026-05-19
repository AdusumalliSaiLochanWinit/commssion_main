// Copies the SADAFCO KSA 25 Salesman plan + all its config (roles, KPIs, slabs,
// deduction rules, monthly targets) from LOCAL pg → PROD (Vercel-linked Neon).
//
// Usage (from server/):
//   node scripts/sync-sadafco-to-prod.js
//
// Prereqs:
//   - ../.env.production has DATABASE_URL (Vercel prod)
//   - server/.env has DATABASE_URL (localhost)
//
// Idempotent: deletes the plan + its child rows on prod, then re-inserts.

import pg from 'pg';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function urlFromEnvFile(p) {
  const txt = readFileSync(p, 'utf8');
  const m = txt.match(/DATABASE_URL=\"?([^\"\n]+)/);
  return m ? m[1] : null;
}

const LOCAL_URL = urlFromEnvFile(path.join(__dirname, '..', '.env'));
const PROD_URL = urlFromEnvFile(path.join(__dirname, '..', '..', '.env.production'));

if (!LOCAL_URL || !PROD_URL) {
  console.error('Missing LOCAL or PROD DATABASE_URL'); process.exit(1);
}

const PLAN_ID = 'plan-sadafco-ksa-25-sm';

async function main() {
  const local = new pg.Pool({ connectionString: LOCAL_URL });
  const prod  = new pg.Pool({ connectionString: PROD_URL, ssl: { rejectUnauthorized: false } });

  console.log('Reading SADAFCO config from LOCAL...');
  const plan = (await local.query('SELECT * FROM commission_plans WHERE id = $1', [PLAN_ID])).rows[0];
  if (!plan) throw new Error('Plan not found on local DB: ' + PLAN_ID);
  const planRoles = (await local.query('SELECT * FROM plan_roles WHERE plan_id = $1', [PLAN_ID])).rows;
  const planKpis  = (await local.query('SELECT * FROM plan_kpis WHERE plan_id = $1', [PLAN_ID])).rows;
  const slabSets  = (await local.query('SELECT * FROM slab_sets WHERE plan_id = $1', [PLAN_ID])).rows;
  const slabIds = slabSets.map(s => s.id);
  const slabTiers = slabIds.length
    ? (await local.query('SELECT * FROM slab_tiers WHERE slab_set_id = ANY($1) ORDER BY slab_set_id, tier_order', [slabIds])).rows
    : [];
  const dedRules  = (await local.query('SELECT * FROM kpi_deduction_rules WHERE plan_id = $1', [PLAN_ID])).rows;
  const monthly   = (await local.query('SELECT * FROM plan_kpi_monthly_targets WHERE plan_id = $1', [PLAN_ID])).rows;

  console.log(`  plan: 1`);
  console.log(`  plan_roles: ${planRoles.length}`);
  console.log(`  plan_kpis: ${planKpis.length}`);
  console.log(`  slab_sets: ${slabSets.length}`);
  console.log(`  slab_tiers: ${slabTiers.length}`);
  console.log(`  kpi_deduction_rules: ${dedRules.length}`);
  console.log(`  monthly_targets: ${monthly.length}`);

  console.log('\nWriting to PROD (transactional)...');
  const c = await prod.connect();
  try {
    await c.query('BEGIN');
    await c.query('DELETE FROM kpi_deduction_rules WHERE plan_id = $1', [PLAN_ID]);
    await c.query('DELETE FROM slab_tiers WHERE slab_set_id IN (SELECT id FROM slab_sets WHERE plan_id = $1)', [PLAN_ID]);
    await c.query('DELETE FROM slab_sets WHERE plan_id = $1', [PLAN_ID]);
    await c.query('DELETE FROM plan_kpis WHERE plan_id = $1', [PLAN_ID]);
    await c.query('DELETE FROM plan_kpi_monthly_targets WHERE plan_id = $1', [PLAN_ID]);
    await c.query('DELETE FROM plan_roles WHERE plan_id = $1', [PLAN_ID]);
    await c.query('DELETE FROM commission_plans WHERE id = $1', [PLAN_ID]);

    const insert = async (table, rows) => {
      if (!rows.length) return;
      const cols = Object.keys(rows[0]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
      const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`;
      for (const r of rows) {
        await c.query(sql, cols.map(k => r[k]));
      }
    };

    await insert('commission_plans', [plan]);
    await insert('plan_roles', planRoles);
    await insert('plan_kpis', planKpis);
    await insert('slab_sets', slabSets);
    await insert('slab_tiers', slabTiers);
    await insert('kpi_deduction_rules', dedRules);
    await insert('plan_kpi_monthly_targets', monthly);

    await c.query('COMMIT');
    console.log('\n✅ Sync committed.');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('\n❌ Sync failed, rolled back:', e.message);
    throw e;
  } finally {
    c.release();
  }

  // Verify on prod
  const v = await prod.query(`
    SELECT
      (SELECT name FROM commission_plans WHERE id=$1) as plan,
      (SELECT COUNT(*) FROM plan_roles WHERE plan_id=$1) as roles,
      (SELECT COUNT(*) FROM plan_kpis WHERE plan_id=$1) as kpis,
      (SELECT COUNT(*) FROM slab_sets WHERE plan_id=$1) as slabs,
      (SELECT COUNT(*) FROM kpi_deduction_rules WHERE plan_id=$1) as deds,
      (SELECT COUNT(*) FROM plan_kpi_monthly_targets WHERE plan_id=$1) as monthly
  `, [PLAN_ID]);
  console.log('\nPROD verification:'); console.table(v.rows);

  await local.end(); await prod.end();
}

main().catch(err => { console.error(err); process.exit(1); });
