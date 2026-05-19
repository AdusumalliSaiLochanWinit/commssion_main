// Generates 2026-05 sample transactions for every NFPC-imported employee so they
// produce real payouts in the live system. Achievement % is deterministically
// varied by user-id-hash so each plan ends up with a clean mix of payouts:
//
//   hash %4 == 0  → 60%  achievement (below 85% floor → SAR 0)
//   hash %4 == 1  → 92%  (Tier 1 partial)
//   hash %4 == 2  → 100% (Tier 1 full + Tier 2 partial)
//   hash %4 == 3  → 110% (capped at 105%)
//
// Targets used per role (match the plan-level target_value set earlier):
//   role-salesman    100,000   (AMB TT & MM)
//   role-pre-sales   80,000    (AMB WS & MT)
//   role-ka-exec     80,000    (AMB OOH)
//   role-van-sales   40,000    (FRZ TT/MM)
//   role-van-driver  40,000    (FRZ MT/OOH)
//
// For each user, generates ~10 sale transactions + 1 return + 1 collection.
//
// Idempotent: deletes any prior 'gen-nfpc-*' transactions for 2026-05 before insert.

import pg from 'pg';
import { v4 as uuid } from 'uuid';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  for (const f of [path.join(__dirname,'..','..','.env.production'), path.join(__dirname,'..','.env')]) {
    if (existsSync(f)) {
      const m = readFileSync(f, 'utf8').match(/DATABASE_URL=\"?([^\"\n]+)/);
      if (m) { DB_URL = m[1]; break; }
    }
  }
}
if (!DB_URL) throw new Error('DATABASE_URL not found');

const PERIOD = '2026-05';
const TXN_DATE = '2026-05-15';

const ROLE_TARGET = {
  'role-salesman':    100000,
  'role-pre-sales':   80000,
  'role-ka-exec':     80000,
  'role-van-sales':   40000,
  'role-van-driver':  40000,
};

// Achievement curve: deterministic by user-index modulo 4
const ACH_BUCKETS = [60, 92, 100, 110];

function hashIndex(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

async function main() {
  const pool = new pg.Pool({ connectionString: DB_URL, ssl: DB_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false, max: 3 });
  const c = await pool.connect();
  try {
    // Reference data
    const custs = (await c.query("SELECT id FROM customers ORDER BY id")).rows.map(r => r.id);
    const prods = (await c.query("SELECT id FROM products ORDER BY id")).rows.map(r => r.id);
    const terrs = (await c.query("SELECT id FROM territories WHERE type='area' OR type='territory' ORDER BY id")).rows.map(r => r.id);
    const fallbackTerr = terrs[0] || (await c.query("SELECT id FROM territories LIMIT 1")).rows[0]?.id;
    console.log(`Ref data: ${custs.length} customers, ${prods.length} products, ${terrs.length} area territories`);

    // NFPC users that map to a plan-relevant role
    const emps = (await c.query(
      `SELECT id, role_id FROM employees
       WHERE id LIKE 'nfpc-%' AND is_active = 1 AND role_id = ANY($1)
       ORDER BY id`,
      [Object.keys(ROLE_TARGET)]
    )).rows;
    console.log(`Generating transactions for ${emps.length} NFPC users in ${PERIOD}`);

    // Wipe any prior generated rows for this period (idempotent re-run)
    const wipe = await c.query(`DELETE FROM transactions WHERE period = $1 AND id LIKE 'gen-nfpc-%'`, [PERIOD]);
    console.log(`Wiped ${wipe.rowCount} prior generated transactions for ${PERIOD}`);

    let inserted = 0;
    const BATCH = 100;
    let batch = [];

    const flush = async () => {
      if (batch.length === 0) return;
      // Multi-row insert
      const cols = '(id, employee_id, customer_id, product_id, transaction_type, quantity, amount, transaction_date, period, territory_id)';
      const vals = [];
      const params = [];
      for (const t of batch) {
        const offset = params.length;
        vals.push(`($${offset+1},$${offset+2},$${offset+3},$${offset+4},$${offset+5},$${offset+6},$${offset+7},$${offset+8},$${offset+9},$${offset+10})`);
        params.push(t.id, t.employee_id, t.customer_id, t.product_id, t.transaction_type, t.quantity, t.amount, t.transaction_date, t.period, t.territory_id);
      }
      await c.query(`INSERT INTO transactions ${cols} VALUES ${vals.join(',')}`, params);
      inserted += batch.length;
      batch = [];
    };

    let i = 0;
    for (const e of emps) {
      const target = ROLE_TARGET[e.role_id];
      const achPct = ACH_BUCKETS[hashIndex(e.id) % ACH_BUCKETS.length];
      const totalSales = Math.round(target * achPct / 100);

      // 10 sale transactions summing to totalSales
      const N = 10;
      const baseAmt = Math.floor(totalSales / N);
      for (let n = 0; n < N; n++) {
        // Vary each by ±15% to make it look realistic
        const variance = 1 + ((hashIndex(e.id + n) % 30) - 15) / 100;
        const amt = Math.round(baseAmt * variance);
        const cust = custs[(hashIndex(e.id + 'c' + n)) % custs.length];
        const prod = prods[(hashIndex(e.id + 'p' + n)) % prods.length];
        const terr = terrs.length > 0 ? terrs[(hashIndex(e.id) % terrs.length)] : fallbackTerr;
        batch.push({
          id: `gen-nfpc-${e.id}-s${n}`,
          employee_id: e.id, customer_id: cust, product_id: prod,
          transaction_type: 'sale',
          quantity: Math.max(1, Math.round(amt / 10)),
          amount: amt,
          transaction_date: TXN_DATE,
          period: PERIOD,
          territory_id: terr,
        });
      }
      // 1 return = 0.45% of sales (lands in the >0.4 to <0.5 bad-return band)
      const returnAmt = Math.round(totalSales * 0.0045);
      if (returnAmt > 0) {
        batch.push({
          id: `gen-nfpc-${e.id}-r0`,
          employee_id: e.id,
          customer_id: custs[hashIndex(e.id + 'rc') % custs.length],
          product_id: prods[hashIndex(e.id + 'rp') % prods.length],
          transaction_type: 'return',
          quantity: 1, amount: returnAmt,
          transaction_date: TXN_DATE, period: PERIOD,
          territory_id: terrs.length > 0 ? terrs[hashIndex(e.id) % terrs.length] : fallbackTerr,
        });
      }
      // 1 collection = 90% of sales (Collection % ≈ 90%)
      const collectionAmt = Math.round(totalSales * 0.9);
      if (collectionAmt > 0) {
        batch.push({
          id: `gen-nfpc-${e.id}-c0`,
          employee_id: e.id,
          customer_id: custs[hashIndex(e.id + 'cc') % custs.length],
          product_id: prods[hashIndex(e.id + 'cp') % prods.length],
          transaction_type: 'collection',
          quantity: 1, amount: collectionAmt,
          transaction_date: TXN_DATE, period: PERIOD,
          territory_id: terrs.length > 0 ? terrs[hashIndex(e.id) % terrs.length] : fallbackTerr,
        });
      }

      if (batch.length >= BATCH) await flush();

      i++;
      if (i % 100 === 0) console.log(`  ${i}/${emps.length} users processed (${inserted} txns inserted)`);
    }
    await flush();
    console.log(`\n✓ Inserted ${inserted} transactions for ${emps.length} NFPC users`);

    // Verify
    const v = await c.query(
      `SELECT t.transaction_type, COUNT(*) c, ROUND(SUM(t.amount)::numeric, 2) total
       FROM transactions t
       WHERE t.period = $1 AND t.id LIKE 'gen-nfpc-%'
       GROUP BY t.transaction_type
       ORDER BY t.transaction_type`,
      [PERIOD]
    );
    console.log('\nVerification by type:');
    console.table(v.rows);

    // Per-role sales distribution
    const v2 = await c.query(
      `SELECT e.role_id, COUNT(DISTINCT t.employee_id) emps,
              ROUND(MIN(per.s)::numeric, 0) min_sales,
              ROUND(MAX(per.s)::numeric, 0) max_sales,
              ROUND(AVG(per.s)::numeric, 0) avg_sales
       FROM (
         SELECT employee_id, SUM(amount) s
         FROM transactions
         WHERE period = $1 AND transaction_type = 'sale' AND id LIKE 'gen-nfpc-%'
         GROUP BY employee_id
       ) per
       JOIN employees e ON e.id = per.employee_id
       GROUP BY e.role_id ORDER BY e.role_id`,
      [PERIOD]
    );
    console.log('\nNFPC sales by role:');
    console.table(v2.rows);
  } catch (e) {
    console.error('FAILED:', e.message);
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
