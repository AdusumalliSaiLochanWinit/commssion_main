// Seeds 8 SADAFCO KSA 25 plans matching the doc's KPI groupings:
//   5 Salesman segments + 3 Supervisor/ASM segments
// Idempotent: wipes & rebuilds each plan by id.
//
// Usage:
//   DATABASE_URL='postgres://...' node scripts/seed-sadafco-8-plans.js
//   (or uses ../.env if no env var)

import pg from 'pg';
import { v4 as uuid } from 'uuid';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve DATABASE_URL from env or .env file
let DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  const envFile = path.join(__dirname, '..', '..', '.env.production');
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/DATABASE_URL=\"?([^\"\n]+)/);
    if (m) DATABASE_URL = m[1];
  }
  if (!DATABASE_URL) {
    const envFile2 = path.join(__dirname, '..', '.env');
    if (existsSync(envFile2)) {
      const m = readFileSync(envFile2, 'utf8').match(/DATABASE_URL=\"?([^\"\n]+)/);
      if (m) DATABASE_URL = m[1];
    }
  }
}
if (!DATABASE_URL) throw new Error('DATABASE_URL not found');

// KPI codes → IDs (resolved at runtime so it works on any DB)
let KPI = {};

// Slab variants per the doc
const SLAB_VARIANTS = {
  SLM_150_350: {
    label: 'Salesman (AMB TT/MM, FRZ-all)',
    tiers: [
      { min: 85,  max: 95,  rate: 150 },
      { min: 95,  max: 105, rate: 350 },
      { min: 105, max: null, rate: 0  },
    ],
  },
  SLM_215_355: {
    label: 'Salesman (AMB WS/MT/OOH)',
    tiers: [
      { min: 85,  max: 100, rate: 215 },
      { min: 100, max: 105, rate: 355 },
      { min: 105, max: null, rate: 0  },
    ],
  },
  SUP_300_375: {
    label: 'Supervisor',
    tiers: [
      { min: 85,  max: 95,  rate: 300 },
      { min: 95,  max: 105, rate: 375 },
      { min: 105, max: null, rate: 0  },
    ],
  },
  ASM_350_535: {
    label: 'ASM',
    tiers: [
      { min: 85,  max: 95,  rate: 350 },
      { min: 95,  max: 105, rate: 535 },
      { min: 105, max: null, rate: 0  },
    ],
  },
};

// Deduction band definitions per the doc
// Each: { kpi, role, name, metric, min, max, minIncl, maxIncl, dedPct }
function bandsForSegment(segmentKey, role) {
  const k = KPI;
  const all = {
    // ===== SALESMAN BANDS =====
    'amb-tt-mm': [
      // TT Overdue (stricter)
      { kpi: k.OVERDUE_PCT, name: 'TT Overdue >2% to <5%',     min: 2,  max: 5,  minIncl:false, maxIncl:false, pct: 10 },
      { kpi: k.OVERDUE_PCT, name: 'TT Overdue >=5% to <=10%',  min: 5,  max: 10, minIncl:true,  maxIncl:true,  pct: 20 },
      { kpi: k.RETURN_PERCENT, name: 'Bad Return >0.4% to <0.5%',  min: 0.4, max: 0.5, minIncl:false, maxIncl:false, pct: 10 },
      { kpi: k.RETURN_PERCENT, name: 'Bad Return >=0.5% to <=0.6%', min: 0.5, max: 0.6, minIncl:true,  maxIncl:true,  pct: 20 },
      { kpi: k.PRODUCTIVE_CALLS, name: 'Productivity >80% to <=85%', min: 80, max: 85, minIncl:false, maxIncl:true,  pct: 10 },
      { kpi: k.PRODUCTIVE_CALLS, name: 'Productivity <80%',          min: null, max: 80, minIncl:false, maxIncl:false, pct: 20 },
      { kpi: k.SKU_PENETRATION, name: 'SKU Dist >=95% to <100%',     min: 95,  max: 100, minIncl:true,  maxIncl:false, pct: 10 },
      { kpi: k.SKU_PENETRATION, name: 'SKU Dist <95%',                min: null, max: 95, minIncl:false, maxIncl:false, pct: 20 },
    ],
    'amb-ws-mt': [
      { kpi: k.OVERDUE_PCT, name: 'WS Overdue >7% to <9%',     min: 7,  max: 9,  minIncl:false, maxIncl:false, pct: 10 },
      { kpi: k.OVERDUE_PCT, name: 'WS Overdue >=9% to <=12%',  min: 9,  max: 12, minIncl:true,  maxIncl:true,  pct: 20 },
      { kpi: k.RETURN_PERCENT, name: 'Bad Return >0.4% to <0.5%',  min: 0.4, max: 0.5, minIncl:false, maxIncl:false, pct: 10 },
      { kpi: k.RETURN_PERCENT, name: 'Bad Return >=0.5% to <=0.6%', min: 0.5, max: 0.6, minIncl:true,  maxIncl:true,  pct: 20 },
      { kpi: k.ROUTE_ADHERENCE, name: 'JP Adh >=90% to <=95%',  min: 90, max: 95, minIncl:true,  maxIncl:true,  pct: 10 },
      { kpi: k.ROUTE_ADHERENCE, name: 'JP Adh >85% to <90%',    min: 85, max: 90, minIncl:false, maxIncl:false, pct: 20 },
      { kpi: k.SKU_PENETRATION, name: 'SKU Dist >=95% to <100%',     min: 95,  max: 100, minIncl:true,  maxIncl:false, pct: 10 },
      { kpi: k.SKU_PENETRATION, name: 'SKU Dist <95%',                min: null, max: 95, minIncl:false, maxIncl:false, pct: 20 },
    ],
    'amb-ooh': [
      { kpi: k.OVERDUE_PCT, name: 'OOH Overdue >7% to <9%',     min: 7,  max: 9,  minIncl:false, maxIncl:false, pct: 10 },
      { kpi: k.OVERDUE_PCT, name: 'OOH Overdue >=9% to <=12%',  min: 9,  max: 12, minIncl:true,  maxIncl:true,  pct: 20 },
      { kpi: k.OTD_PERCENT, name: 'Inv Customers >=70% to <80%', min: 70, max: 80, minIncl:true, maxIncl:false, pct: 10 },
      { kpi: k.OTD_PERCENT, name: 'Inv Customers >=60% to <70%', min: 60, max: 70, minIncl:true, maxIncl:false, pct: 20 },
      { kpi: k.NEW_CUSTOMERS, name: 'New Customer >=85% to <95%', min: 85, max: 95, minIncl:true, maxIncl:false, pct: 10 },
      { kpi: k.NEW_CUSTOMERS, name: 'New Customer >=75% to <85%', min: 75, max: 85, minIncl:true, maxIncl:false, pct: 20 },
    ],
    'frz-tt-mm': [
      { kpi: k.IMAGE_VERIFY, name: 'IR <90% to <=95%', min: null, max: 95, minIncl:false, maxIncl:true, pct: 10 },
      { kpi: k.RETURN_PERCENT, name: 'Bad Return >0.4% to <0.5%',  min: 0.4, max: 0.5, minIncl:false, maxIncl:false, pct: 10 },
      { kpi: k.RETURN_PERCENT, name: 'Bad Return >=0.5% to <=0.6%', min: 0.5, max: 0.6, minIncl:true,  maxIncl:true,  pct: 20 },
      { kpi: k.PRODUCTIVE_CALLS, name: 'Productivity >80% to <=85%', min: 80, max: 85, minIncl:false, maxIncl:true,  pct: 10 },
      { kpi: k.PRODUCTIVE_CALLS, name: 'Productivity <80%',          min: null, max: 80, minIncl:false, maxIncl:false, pct: 20 },
      { kpi: k.SKU_PENETRATION, name: 'SKU Dist >=95% to <100%',     min: 95,  max: 100, minIncl:true,  maxIncl:false, pct: 10 },
      { kpi: k.SKU_PENETRATION, name: 'SKU Dist <95%',                min: null, max: 95, minIncl:false, maxIncl:false, pct: 20 },
    ],
    'frz-mt-ooh': [
      { kpi: k.RETURN_PERCENT, name: 'Bad Return >0.4% to <0.5%',  min: 0.4, max: 0.5, minIncl:false, maxIncl:false, pct: 10 },
      { kpi: k.RETURN_PERCENT, name: 'Bad Return >=0.5% to <=0.6%', min: 0.5, max: 0.6, minIncl:true,  maxIncl:true,  pct: 20 },
      { kpi: k.ROUTE_ADHERENCE, name: 'JP Adh >=90% to <=95%',  min: 90, max: 95, minIncl:true,  maxIncl:true,  pct: 10 },
      { kpi: k.ROUTE_ADHERENCE, name: 'JP Adh >85% to <90%',    min: 85, max: 90, minIncl:false, maxIncl:false, pct: 20 },
      { kpi: k.SKU_PENETRATION, name: 'SKU Dist >=95% to <100%',     min: 95,  max: 100, minIncl:true,  maxIncl:false, pct: 10 },
      { kpi: k.SKU_PENETRATION, name: 'SKU Dist <95%',                min: null, max: 95, minIncl:false, maxIncl:false, pct: 20 },
    ],
    // ===== SUPERVISOR / ASM BANDS =====
    'sup-amb': [
      { kpi: k.OVERDUE_PCT, name: 'Sup/ASM Overdue >7% to <9%',     min: 7,  max: 9,  minIncl:false, maxIncl:false, pct: 10 },
      { kpi: k.OVERDUE_PCT, name: 'Sup/ASM Overdue >=9% to <=12%',  min: 9,  max: 12, minIncl:true,  maxIncl:true,  pct: 20 },
      { kpi: k.RETURN_PERCENT, name: 'Bad Return >0.4% to <0.5%',  min: 0.4, max: 0.5, minIncl:false, maxIncl:false, pct: 10 },
      { kpi: k.RETURN_PERCENT, name: 'Bad Return >=0.5% to <=0.6%', min: 0.5, max: 0.6, minIncl:true,  maxIncl:true,  pct: 20 },
      { kpi: k.ROUTE_ADHERENCE, name: 'JP Adh >=90% to <=95%',  min: 90, max: 95, minIncl:true,  maxIncl:true,  pct: 10 },
      { kpi: k.ROUTE_ADHERENCE, name: 'JP Adh >85% to <90%',    min: 85, max: 90, minIncl:false, maxIncl:false, pct: 20 },
      { kpi: k.ZERO_SALES_OUTLET, name: 'Zero Sales >=6%', min: 6, max: null, minIncl:true, maxIncl:false, pct: 10 },
    ],
    'sup-frz': [
      { kpi: k.IMAGE_VERIFY, name: 'IR <90%', min: null, max: 90, minIncl:false, maxIncl:false, pct: 10 },
      { kpi: k.RETURN_PERCENT, name: 'Bad Return >0.4% to <0.5%',  min: 0.4, max: 0.5, minIncl:false, maxIncl:false, pct: 10 },
      { kpi: k.RETURN_PERCENT, name: 'Bad Return >=0.5% to <=0.6%', min: 0.5, max: 0.6, minIncl:true,  maxIncl:true,  pct: 20 },
      { kpi: k.ROUTE_ADHERENCE, name: 'JP Adh >=90% to <=95%',  min: 90, max: 95, minIncl:true,  maxIncl:true,  pct: 10 },
      { kpi: k.ROUTE_ADHERENCE, name: 'JP Adh >85% to <90%',    min: 85, max: 90, minIncl:false, maxIncl:false, pct: 20 },
      { kpi: k.ZERO_SALES_OUTLET, name: 'Zero Sales >=6%', min: 6, max: null, minIncl:true, maxIncl:false, pct: 10 },
    ],
    'sup-ooh': [
      { kpi: k.OVERDUE_PCT, name: 'Sup OOH Overdue >7% to <9%',     min: 7,  max: 9,  minIncl:false, maxIncl:false, pct: 10 },
      { kpi: k.OVERDUE_PCT, name: 'Sup OOH Overdue >=9% to <=12%',  min: 9,  max: 12, minIncl:true,  maxIncl:true,  pct: 20 },
      { kpi: k.RETURN_PERCENT, name: 'Bad Return >0.4% to <0.5%',  min: 0.4, max: 0.5, minIncl:false, maxIncl:false, pct: 10 },
      { kpi: k.RETURN_PERCENT, name: 'Bad Return >=0.5% to <=0.6%', min: 0.5, max: 0.6, minIncl:true,  maxIncl:true,  pct: 20 },
      { kpi: k.ROUTE_ADHERENCE, name: 'JP Adh >=90% to <=95%',  min: 90, max: 95, minIncl:true,  maxIncl:true,  pct: 10 },
      { kpi: k.ROUTE_ADHERENCE, name: 'JP Adh >85% to <90%',    min: 85, max: 90, minIncl:false, maxIncl:false, pct: 20 },
      { kpi: k.OTD_PERCENT, name: 'Inv Customers >=70% to <80%', min: 70, max: 80, minIncl:true, maxIncl:false, pct: 10 },
      { kpi: k.OTD_PERCENT, name: 'Inv Customers >=60% to <70%', min: 60, max: 70, minIncl:true, maxIncl:false, pct: 20 },
    ],
  };
  return (all[segmentKey] || []).map(b => ({ ...b, role }));
}

// 8 plans
const PLANS = [
  // ----- SALESMAN TIER (5) -----
  {
    id: 'plan-sadafco-amb-tt-mm',
    name: 'SADAFCO KSA 25 — AMB TT & MM Salesman',
    description: 'Salesman tier, AMB Traditional Trade & Mini Market. Slab 150/350 per 1% achievement.',
    segment: 'amb-tt-mm',
    roles: ['role-salesman'],
    slab: { variant: 'SLM_150_350', byRole: { 'role-salesman': 'SLM_150_350' } },
    monitoring: ['OVERDUE_PCT','RETURN_PERCENT','PRODUCTIVE_CALLS','SKU_PENETRATION'],
  },
  {
    id: 'plan-sadafco-amb-ws-mt',
    name: 'SADAFCO KSA 25 — AMB WS & MT Presalesman',
    description: 'Presalesman tier, AMB Wholesale & Modern Trade. Slab 215/355 per 1%.',
    segment: 'amb-ws-mt',
    roles: ['role-pre-sales'],
    slab: { variant: 'SLM_215_355', byRole: { 'role-pre-sales': 'SLM_215_355' } },
    monitoring: ['OVERDUE_PCT','RETURN_PERCENT','ROUTE_ADHERENCE','SKU_PENETRATION'],
  },
  {
    id: 'plan-sadafco-amb-ooh',
    name: 'SADAFCO KSA 25 — AMB OOH Salesman',
    description: 'Out-of-Home Salesman. Slab 215/355 per 1%.',
    segment: 'amb-ooh',
    roles: ['role-ka-exec'],
    slab: { variant: 'SLM_215_355', byRole: { 'role-ka-exec': 'SLM_215_355' } },
    monitoring: ['OVERDUE_PCT','OTD_PERCENT','NEW_CUSTOMERS'],
  },
  {
    id: 'plan-sadafco-frz-tt-mm',
    name: 'SADAFCO KSA 25 — FRZ (TT & MM) Salesman',
    description: 'Frozen Salesman TT & MM channels. Slab 150/350 per 1%.',
    segment: 'frz-tt-mm',
    roles: ['role-van-sales'],
    slab: { variant: 'SLM_150_350', byRole: { 'role-van-sales': 'SLM_150_350' } },
    monitoring: ['IMAGE_VERIFY','RETURN_PERCENT','PRODUCTIVE_CALLS','SKU_PENETRATION'],
  },
  {
    id: 'plan-sadafco-frz-mt-ooh',
    name: 'SADAFCO KSA 25 — FRZ MT & OOH Salesman',
    description: 'Frozen Salesman MT & OOH channels. Slab 150/350 per 1%.',
    segment: 'frz-mt-ooh',
    roles: ['role-van-driver'],
    slab: { variant: 'SLM_150_350', byRole: { 'role-van-driver': 'SLM_150_350' } },
    monitoring: ['RETURN_PERCENT','ROUTE_ADHERENCE','SKU_PENETRATION'],
  },
  // ----- SUPERVISOR / ASM TIER (3) -----
  {
    id: 'plan-sadafco-sup-amb',
    name: 'SADAFCO KSA 25 — Supervisor & ASM AMB',
    description: 'Supervisor (300/375) & ASM (350/535) for AMB business. Mix routes use AMB scoring.',
    segment: 'sup-amb',
    roles: ['role-ss','role-route-sup','role-asm'],
    slab: { variant: 'SUP_300_375', byRole: { 'role-ss': 'SUP_300_375', 'role-route-sup': 'SUP_300_375', 'role-asm': 'ASM_350_535' } },
    monitoring: ['OVERDUE_PCT','RETURN_PERCENT','ROUTE_ADHERENCE','ZERO_SALES_OUTLET'],
  },
  {
    id: 'plan-sadafco-sup-frz',
    name: 'SADAFCO KSA 25 — Supervisor & ASM FRZ',
    description: 'Supervisor & ASM for Frozen business. Mix routes use AMB scoring per doc.',
    segment: 'sup-frz',
    roles: ['role-ss','role-route-sup','role-asm'],
    slab: { variant: 'SUP_300_375', byRole: { 'role-ss': 'SUP_300_375', 'role-route-sup': 'SUP_300_375', 'role-asm': 'ASM_350_535' } },
    monitoring: ['IMAGE_VERIFY','RETURN_PERCENT','ROUTE_ADHERENCE','ZERO_SALES_OUTLET'],
  },
  {
    id: 'plan-sadafco-sup-ooh',
    name: 'SADAFCO KSA 25 — Supervisor OOH',
    description: 'Supervisor OOH segment.',
    segment: 'sup-ooh',
    roles: ['role-ss','role-route-sup','role-asm'],
    slab: { variant: 'SUP_300_375', byRole: { 'role-ss': 'SUP_300_375', 'role-route-sup': 'SUP_300_375', 'role-asm': 'ASM_350_535' } },
    monitoring: ['OVERDUE_PCT','RETURN_PERCENT','ROUTE_ADHERENCE','OTD_PERCENT'],
  },
];

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false });
  const c = await pool.connect();
  try {
    // Resolve KPI IDs by code
    const kpiCodes = ['TOTAL_REVENUE','RETURN_PERCENT','OVERDUE_PCT','PRODUCTIVE_CALLS','SKU_PENETRATION','ROUTE_ADHERENCE','IMAGE_VERIFY','NEW_CUSTOMERS','OTD_PERCENT','ZERO_SALES_OUTLET','INV_DELIVERED'];
    const kpiRows = await c.query(`SELECT id, code FROM kpi_definitions WHERE code = ANY($1)`, [kpiCodes]);
    for (const r of kpiRows.rows) KPI[r.code] = r.id;
    const missing = kpiCodes.filter(k => !KPI[k]);
    if (missing.length) throw new Error('Missing KPI codes on this DB: ' + missing.join(','));
    console.log('Resolved', Object.keys(KPI).length, 'KPI ids');

    await c.query('BEGIN');

    for (const plan of PLANS) {
      // Wipe prior version of this plan
      await c.query(`DELETE FROM kpi_deduction_rules WHERE plan_id=$1`, [plan.id]);
      await c.query(`DELETE FROM slab_tiers WHERE slab_set_id IN (SELECT id FROM slab_sets WHERE plan_id=$1)`, [plan.id]);
      await c.query(`DELETE FROM slab_sets WHERE plan_id=$1`, [plan.id]);
      await c.query(`DELETE FROM plan_kpis WHERE plan_id=$1`, [plan.id]);
      await c.query(`DELETE FROM plan_roles WHERE plan_id=$1`, [plan.id]);
      await c.query(`DELETE FROM commission_plans WHERE id=$1`, [plan.id]);

      // commission_plans
      await c.query(
        `INSERT INTO commission_plans (id, name, description, status, plan_type, effective_from, effective_to, base_payout)
         VALUES ($1,$2,$3,'active','monthly','2026-01-01','2026-12-31',0)`,
        [plan.id, plan.name, plan.description]
      );

      // plan_roles
      for (const r of plan.roles) {
        await c.query(`INSERT INTO plan_roles (id, plan_id, role_id) VALUES ($1,$2,$3)`, [uuid(), plan.id, r]);
      }

      // plan_kpis — driver TOTAL_REVENUE at weight=100, monitoring at weight=0
      await c.query(
        `INSERT INTO plan_kpis (id, plan_id, kpi_id, weight, target_value, slab_set_id)
         VALUES ($1,$2,$3,100,100000,NULL)`,
        [uuid(), plan.id, KPI.TOTAL_REVENUE]
      );
      for (const mc of plan.monitoring) {
        await c.query(
          `INSERT INTO plan_kpis (id, plan_id, kpi_id, weight, target_value, slab_set_id)
           VALUES ($1,$2,$3,0,100,NULL)`,
          [uuid(), plan.id, KPI[mc]]
        );
      }

      // slab_sets per role
      for (const role of plan.roles) {
        const variant = plan.slab.byRole[role] || plan.slab.variant;
        const v = SLAB_VARIANTS[variant];
        const ssId = uuid();
        await c.query(
          `INSERT INTO slab_sets (id, name, type, plan_id, kpi_id, role_id)
           VALUES ($1,$2,'progressive',$3,$4,$5)`,
          [ssId, `Sales Ach Slab — ${role} (${variant})`, plan.id, KPI.TOTAL_REVENUE, role]
        );
        for (let i = 0; i < v.tiers.length; i++) {
          const t = v.tiers[i];
          await c.query(
            `INSERT INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type, min_inclusive, max_inclusive)
             VALUES ($1,$2,$3,$4,$5,$6,'per_achievement_point',0,1)`,
            [uuid(), ssId, i + 1, t.min, t.max, t.rate]
          );
        }
      }

      // kpi_deduction_rules — scoped per role within the plan
      for (const role of plan.roles) {
        const bands = bandsForSegment(plan.segment, role);
        for (const b of bands) {
          await c.query(
            `INSERT INTO kpi_deduction_rules (id, plan_id, kpi_id, role_id, name, metric_type, min_value, max_value, min_inclusive, max_inclusive, deduction_percent, priority, is_active)
             VALUES ($1,$2,$3,$4,$5,'actual_value',$6,$7,$8,$9,$10,0,1)`,
            [uuid(), plan.id, b.kpi, role, b.name, b.min, b.max, b.minIncl ? 1 : 0, b.maxIncl ? 1 : 0, b.pct]
          );
        }
      }

      console.log('  ✓ ' + plan.name);
    }

    await c.query('COMMIT');
    console.log('\n=== Seeded 8 SADAFCO plans ===');
    const v = await c.query(`SELECT id, name FROM commission_plans WHERE id LIKE 'plan-sadafco-%' ORDER BY id`);
    v.rows.forEach(r => console.log('  ' + r.id + ' → ' + r.name));
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
