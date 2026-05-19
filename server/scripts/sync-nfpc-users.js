// Syncs VanSales + PreSales + Supervisor/ASM users from nfpcproduct → commission DB.
// Designation/role mapping:
//   designation='VanSales'   → role-salesman      (AMB TT/MM + FRZ Salesman plans)
//   designation='PreSales'   → role-pre-sales     (AMB WS & MT Presalesman plan)
//   user_role_uid in supervisor codes → role-ss   (Supervisor plans)
//   user_role_uid in ASM codes        → role-asm  (ASM slab in Supervisor plans)
//
// Source:  postgresql://choithram:choithram@10.20.53.10:5432/nfpcproduct
// Target:  DATABASE_URL from .env.production (Neon)
// Commits every 50 rows to avoid Neon idle-connection drops.

import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let TARGET_URL = process.env.DATABASE_URL;
if (!TARGET_URL) {
  for (const f of [path.join(__dirname,'..','..','.env.production'), path.join(__dirname,'..','.env')]) {
    if (existsSync(f)) {
      const m = readFileSync(f, 'utf8').match(/DATABASE_URL=\"?([^\"\n]+)/);
      if (m) { TARGET_URL = m[1]; break; }
    }
  }
}
if (!TARGET_URL) throw new Error('Target DATABASE_URL not found');

const SOURCE = {
  host: '10.20.53.10', port: 5432, database: 'nfpcproduct',
  user: 'choithram', password: 'choithram', connectionTimeoutMillis: 10000,
};

const SUPERVISOR_ROLE_UIDS = ['SUPERVISOR', 'C_SALES_SUPERVISOR'];
const ASM_ROLE_UIDS = ['ASM', 'AASM'];

function mapToCommissionRole(src) {
  if (src.designation === 'VanSales') return 'role-salesman';
  if (src.designation === 'PreSales') return 'role-pre-sales';
  const ur = (src.user_role_uid || '').toUpperCase();
  if (SUPERVISOR_ROLE_UIDS.includes(ur)) return 'role-ss';
  if (ASM_ROLE_UIDS.includes(ur)) return 'role-asm';
  return null;
}

async function main() {
  const src = new pg.Client(SOURCE);
  await src.connect();
  console.log('✓ Connected to source (nfpcproduct @ 10.20.53.10)');

  const tgtPool = new pg.Pool({
    connectionString: TARGET_URL,
    ssl: TARGET_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
    max: 3,
  });
  let tgt = await tgtPool.connect();
  console.log('✓ Connected to target (commission Neon DB)');

  try {
    // Pull only the three categories the user wants
    const q = `
      SELECT uid, emp_uid, designation, department, user_role_uid,
             reports_to_uid, location_uid, branch_uid, created_time
      FROM public.job_position
      WHERE designation IN ('VanSales', 'PreSales')
         OR UPPER(COALESCE(user_role_uid, '')) IN (
              'SUPERVISOR', 'C_SALES_SUPERVISOR', 'ASM', 'AASM'
            )
      ORDER BY designation, user_role_uid, uid
    `;
    const src_users = await src.query(q);
    console.log(`✓ Fetched ${src_users.rows.length} candidate users from source`);

    // Pre-flight: verify commission roles exist in target
    const targetRoles = ['role-salesman', 'role-pre-sales', 'role-ss', 'role-asm'];
    const have = await tgt.query(`SELECT id FROM roles WHERE id = ANY($1)`, [targetRoles]);
    const haveSet = new Set(have.rows.map(r => r.id));
    const missing = targetRoles.filter(r => !haveSet.has(r));
    if (missing.length) {
      console.warn(`⚠ Missing roles in target (will skip these mappings): ${missing.join(', ')}`);
    }

    // Upsert in batches of 50, COMMIT between batches
    let inserted = 0, updated = 0, skipped = 0, byRole = {};
    const BATCH = 50;
    let batchN = 0;

    const ensureTxn = async () => {
      try { await tgt.query('BEGIN'); } catch (e) {
        // Connection dead — reconnect
        try { tgt.release(); } catch {}
        tgt = await tgtPool.connect();
        await tgt.query('BEGIN');
      }
    };
    await ensureTxn();

    for (const r of src_users.rows) {
      const role_id = mapToCommissionRole(r);
      if (!role_id || !haveSet.has(role_id)) { skipped++; continue; }

      const empId = 'nfpc-' + r.uid;
      const name = r.emp_uid || (r.designation + '-' + r.uid);
      const email = (r.uid || 'unknown').toLowerCase() + '@nfpc.local';
      const hire_date = r.created_time
        ? new Date(r.created_time).toISOString().slice(0,10)
        : '2026-01-01';

      try {
        const up = await tgt.query(
          `INSERT INTO employees (id, name, email, external_id, role_id, territory_id, reports_to, base_salary, hire_date, is_active)
           VALUES ($1, $2, $3, $4, $5, NULL, NULL, 0, $6, 1)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             email = EXCLUDED.email,
             external_id = EXCLUDED.external_id,
             role_id = EXCLUDED.role_id,
             is_active = 1
           RETURNING (xmax = 0) AS inserted`,
          [empId, name, email, r.emp_uid, role_id, hire_date]
        );
        if (up.rows[0]?.inserted) inserted++; else updated++;
        byRole[role_id] = (byRole[role_id] || 0) + 1;
      } catch (e) {
        if (e.message.includes('terminated') || e.message.includes('connection')) {
          console.warn(`  reconnecting after: ${e.message.slice(0,80)}`);
          try { tgt.release(); } catch {}
          tgt = await tgtPool.connect();
          await ensureTxn();
        } else {
          throw e;
        }
      }

      batchN++;
      if (batchN >= BATCH) {
        await tgt.query('COMMIT');
        if ((inserted + updated) % 200 === 0) console.log(`  ... ${inserted + updated} processed`);
        await ensureTxn();
        batchN = 0;
      }
    }
    await tgt.query('COMMIT');

    console.log('\n=== Sync complete ===');
    console.log(`  Inserted:  ${inserted}`);
    console.log(`  Updated:   ${updated}`);
    console.log(`  Skipped:   ${skipped}`);
    console.log('  Per role:');
    for (const [k, v] of Object.entries(byRole)) console.log(`    ${k.padEnd(20)} ${v}`);

    const verify = await tgt.query(
      `SELECT role_id, COUNT(*) c FROM employees
       WHERE id LIKE 'nfpc-%' AND is_active = 1
       GROUP BY role_id ORDER BY c DESC`
    );
    console.log('\n  Imported users in commission DB:');
    for (const v of verify.rows) console.log(`    ${v.role_id.padEnd(20)} → ${v.c} users`);
  } catch (e) {
    try { await tgt.query('ROLLBACK'); } catch {}
    console.error('FAILED:', e.message);
    throw e;
  } finally {
    try { tgt.release(); } catch {}
    await tgtPool.end();
    await src.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
