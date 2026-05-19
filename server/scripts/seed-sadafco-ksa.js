// Seeds "Sales Commission 25 KSA — Salesman" per the SADAFCO doc.
// Idempotent: re-running wipes only the plan rows it owns, then re-inserts.
//
// Usage:
//   cd server && node scripts/seed-sadafco-ksa.js
//
// What it creates:
//   - 5 segment roles (AMB TT/MM, AMB WS/MT, AMB OOH, FRZ TT/MM, FRZ MT/OOH)
//   - 9 KPI definitions (1 driver + 8 deduction-only)
//   - 1 plan with all 5 roles attached
//   - 2 slab sets (150/350 group and 215/355 group), role-scoped, progressive per_achievement_point
//   - plan_kpis: 1 driver KPI weight=100 + deduction KPIs weight=0 per segment
//   - kpi_deduction_rules with banded actual_value thresholds per the doc

import pg from 'pg';
import { v4 as uuid } from 'uuid';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '..', '.env') });

const PLAN_ID = 'plan-sadafco-ksa-25-sm';

const ROLES = {
  AMB_TT_MM:    { id: 'role-amb-tt-mm-sm',   name: 'AMB TT & MM Salesman (KSA 25)',         level: 1 },
  AMB_WS_MT:    { id: 'role-amb-ws-mt-pre',  name: 'AMB WS & MT Presalesman (KSA 25)',      level: 1 },
  AMB_OOH:      { id: 'role-amb-ooh-sm',     name: 'AMB OOH Salesman (KSA 25)',             level: 1 },
  FRZ_TT_MM:    { id: 'role-frz-tt-mm-sm',   name: 'FRZ (TT & MM) Salesman (KSA 25)',       level: 1 },
  FRZ_MT_OOH:   { id: 'role-frz-mt-ooh-sm',  name: 'FRZ MT & OOH Salesman (KSA 25)',        level: 1 },
};

const KPIS = {
  SALES_ACH:    { id: 'kpi-sadafco-sales-ach',    code: 'SADAFCO_SALES_ACH',       name: 'Sales Achievement %',           category: 'Revenue',      unit: 'percentage', direction: 'higher_is_better' },
  OVERDUE:      { id: 'kpi-sadafco-overdue',      code: 'SADAFCO_OVERDUE',         name: 'Overdue (TC & Local GC)',       category: 'Collection',   unit: 'percentage', direction: 'lower_is_better'  },
  BAD_RETURN:   { id: 'kpi-sadafco-bad-return',   code: 'SADAFCO_BAD_RETURN',      name: 'Bad Return %',                  category: 'Returns',      unit: 'percentage', direction: 'lower_is_better'  },
  PRODUCTIVITY: { id: 'kpi-sadafco-prod',         code: 'SADAFCO_PRODUCTIVITY',    name: 'Productivity %',                category: 'Efficiency',   unit: 'percentage', direction: 'higher_is_better' },
  SKU_DIST:     { id: 'kpi-sadafco-sku-dist',     code: 'SADAFCO_SKU_DIST',        name: 'Selected SKU Distribution %',   category: 'Distribution', unit: 'percentage', direction: 'higher_is_better' },
  JP_ADH:       { id: 'kpi-sadafco-jp-adh',       code: 'SADAFCO_JP_ADHERENCE',    name: 'JP Adherence %',                category: 'Compliance',   unit: 'percentage', direction: 'higher_is_better' },
  IMAGE_REC:    { id: 'kpi-sadafco-image-rec',    code: 'SADAFCO_IMAGE_REC',       name: 'Image Recognition %',           category: 'Compliance',   unit: 'percentage', direction: 'higher_is_better' },
  NEW_CUST:     { id: 'kpi-sadafco-new-cust',     code: 'SADAFCO_NEW_CUST',        name: 'New Customer Acquisition %',    category: 'Customer',     unit: 'percentage', direction: 'higher_is_better' },
  INV_CUST:     { id: 'kpi-sadafco-inv-cust',     code: 'SADAFCO_INV_CUST',        name: 'Number of Invoiced Customers %',category: 'Service',      unit: 'percentage', direction: 'higher_is_better' },
};

// Per the doc, segment → deduction KPIs
const SEGMENT_DEDUCTION_KPIS = {
  [ROLES.AMB_TT_MM.id]:   ['OVERDUE','BAD_RETURN','PRODUCTIVITY','SKU_DIST'],
  [ROLES.AMB_WS_MT.id]:   ['OVERDUE','BAD_RETURN','JP_ADH','SKU_DIST'],
  [ROLES.AMB_OOH.id]:     ['OVERDUE','INV_CUST','NEW_CUST'],
  [ROLES.FRZ_TT_MM.id]:   ['IMAGE_REC','BAD_RETURN','PRODUCTIVITY','SKU_DIST'],
  [ROLES.FRZ_MT_OOH.id]:  ['BAD_RETURN','JP_ADH','SKU_DIST'],
};

// 150/350 group: AMB TT/MM + all FRZ channels
const SLAB_GROUP_A_ROLES = [ROLES.AMB_TT_MM.id, ROLES.FRZ_TT_MM.id, ROLES.FRZ_MT_OOH.id];
// 215/355 group: AMB WS/MT/OOH
const SLAB_GROUP_B_ROLES = [ROLES.AMB_WS_MT.id, ROLES.AMB_OOH.id];

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    // 1. ROLES — upsert
    for (const r of Object.values(ROLES)) {
      await c.query(
        `INSERT INTO roles (id, name, level, description, is_field_role)
         VALUES ($1, $2, $3, $4, 1)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, level = EXCLUDED.level`,
        [r.id, r.name, r.level, `SADAFCO KSA 25 segment role`]
      );
    }

    // 2. KPI definitions — upsert
    for (const k of Object.values(KPIS)) {
      const formula = JSON.stringify({ type: 'static', defaultValue: 100, source: 'external' });
      const applicableRoles = JSON.stringify(Object.values(ROLES).map(r => r.id));
      await c.query(
        `INSERT INTO kpi_definitions (id, name, code, category, description, formula, unit, direction, applicable_roles, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, category = EXCLUDED.category, formula = EXCLUDED.formula,
           unit = EXCLUDED.unit, direction = EXCLUDED.direction, applicable_roles = EXCLUDED.applicable_roles`,
        [k.id, k.name, k.code, k.category, `SADAFCO KSA 25 KPI: ${k.name}`, formula, k.unit, k.direction, applicableRoles]
      );
    }

    // 3. PLAN — wipe + recreate
    await c.query(`DELETE FROM kpi_deduction_rules WHERE plan_id = $1`, [PLAN_ID]);
    await c.query(`DELETE FROM slab_tiers WHERE slab_set_id IN (SELECT id FROM slab_sets WHERE plan_id = $1)`, [PLAN_ID]);
    await c.query(`DELETE FROM slab_sets WHERE plan_id = $1`, [PLAN_ID]);
    await c.query(`DELETE FROM plan_kpis WHERE plan_id = $1`, [PLAN_ID]);
    await c.query(`DELETE FROM plan_roles WHERE plan_id = $1`, [PLAN_ID]);
    await c.query(`DELETE FROM commission_plans WHERE id = $1`, [PLAN_ID]);

    await c.query(
      `INSERT INTO commission_plans (id, name, description, status, plan_type, effective_from, effective_to, base_payout)
       VALUES ($1, $2, $3, 'active', 'monthly', '2025-01-01', '2025-12-31', 0)`,
      [PLAN_ID, 'Sales Commission 25 KSA — Salesman', 'SADAFCO KSA 2025 — Salesman tier (AMB & FRZ). SAR per 1% achievement via progressive slabs.']
    );

    // 4. PLAN ROLES
    for (const r of Object.values(ROLES)) {
      await c.query(
        `INSERT INTO plan_roles (id, plan_id, role_id) VALUES ($1, $2, $3)`,
        [uuid(), PLAN_ID, r.id]
      );
    }

    // 5. SLAB SETS — per role, progressive, per_achievement_point
    const slabGroupA = { tiers: [
      { tier_order: 1, min_percent: 85,  max_percent: 95,  rate: 150, rate_type: 'per_achievement_point' },
      { tier_order: 2, min_percent: 95,  max_percent: 105, rate: 350, rate_type: 'per_achievement_point' },
    ]};
    const slabGroupB = { tiers: [
      { tier_order: 1, min_percent: 85,  max_percent: 100, rate: 215, rate_type: 'per_achievement_point' },
      { tier_order: 2, min_percent: 100, max_percent: 105, rate: 355, rate_type: 'per_achievement_point' },
    ]};

    const slabSetIdByRole = {};
    for (const roleId of SLAB_GROUP_A_ROLES) {
      const ssId = uuid();
      slabSetIdByRole[roleId] = ssId;
      await c.query(
        `INSERT INTO slab_sets (id, name, type, plan_id, kpi_id, role_id)
         VALUES ($1, $2, 'progressive', $3, $4, $5)`,
        [ssId, `Sales Ach Slab — ${roleId} (150/350)`, PLAN_ID, KPIS.SALES_ACH.id, roleId]
      );
      for (const t of slabGroupA.tiers) {
        await c.query(
          `INSERT INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type, min_inclusive, max_inclusive)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 1)`,
          [uuid(), ssId, t.tier_order, t.min_percent, t.max_percent, t.rate, t.rate_type]
        );
      }
    }
    for (const roleId of SLAB_GROUP_B_ROLES) {
      const ssId = uuid();
      slabSetIdByRole[roleId] = ssId;
      await c.query(
        `INSERT INTO slab_sets (id, name, type, plan_id, kpi_id, role_id)
         VALUES ($1, $2, 'progressive', $3, $4, $5)`,
        [ssId, `Sales Ach Slab — ${roleId} (215/355)`, PLAN_ID, KPIS.SALES_ACH.id, roleId]
      );
      for (const t of slabGroupB.tiers) {
        await c.query(
          `INSERT INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type, min_inclusive, max_inclusive)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 1)`,
          [uuid(), ssId, t.tier_order, t.min_percent, t.max_percent, t.rate, t.rate_type]
        );
      }
    }

    // 6. PLAN_KPIS — Sales Ach (driver, weight=100) + deduction-only KPIs (weight=0)
    //    Driver KPI gets the role-agnostic slab_set_id null — slabs are resolved by role at calc-time
    //    (engine looks up slab_sets by plan_id + kpi_id, then filters by role_id if present)
    await c.query(
      `INSERT INTO plan_kpis (id, plan_id, kpi_id, weight, target_value, slab_set_id)
       VALUES ($1, $2, $3, 100, 100, NULL)`,
      [uuid(), PLAN_ID, KPIS.SALES_ACH.id]
    );

    // One plan_kpi row per distinct deduction KPI used across segments (UNIQUE plan_id+kpi_id)
    const allDeductionKpis = new Set();
    Object.values(SEGMENT_DEDUCTION_KPIS).forEach(arr => arr.forEach(k => allDeductionKpis.add(k)));
    for (const kpiKey of allDeductionKpis) {
      const k = KPIS[kpiKey];
      await c.query(
        `INSERT INTO plan_kpis (id, plan_id, kpi_id, weight, target_value, slab_set_id)
         VALUES ($1, $2, $3, 0, 100, NULL)`,
        [uuid(), PLAN_ID, k.id]
      );
    }

    // 7. KPI DEDUCTION RULES — per the doc, scoped by role_id where applicable
    // metric_type = 'actual_value' (the KPI's measured % is what's compared)
    const ded = async (roleId, kpiKey, name, min, max, minIncl, maxIncl, dedPct) => {
      await c.query(
        `INSERT INTO kpi_deduction_rules (id, plan_id, kpi_id, role_id, name, metric_type, min_value, max_value, min_inclusive, max_inclusive, deduction_percent, priority, is_active)
         VALUES ($1, $2, $3, $4, $5, 'actual_value', $6, $7, $8, $9, $10, 0, 1)`,
        [uuid(), PLAN_ID, KPIS[kpiKey].id, roleId, name, min, max, minIncl ? 1 : 0, maxIncl ? 1 : 0, dedPct]
      );
    };

    // ----- OVERDUE -----
    // TT Overdue thresholds (stricter) — applies to AMB TT/MM Salesman
    await ded(ROLES.AMB_TT_MM.id, 'OVERDUE', 'TT Overdue >2% to <5%',  2,  5, false, false, 10);
    await ded(ROLES.AMB_TT_MM.id, 'OVERDUE', 'TT Overdue >=5% to <=10%', 5, 10, true,  true,  20);
    // WS/MT/OOH (and MM per doc header) Overdue thresholds
    for (const roleId of [ROLES.AMB_WS_MT.id, ROLES.AMB_OOH.id]) {
      await ded(roleId, 'OVERDUE', 'WS/MT/OOH Overdue >7% to <9%',  7,  9, false, false, 10);
      await ded(roleId, 'OVERDUE', 'WS/MT/OOH Overdue >=9% to <=12%', 9, 12, true,  true,  20);
    }

    // ----- BAD RETURN (all routes) -----
    for (const roleId of [ROLES.AMB_TT_MM.id, ROLES.AMB_WS_MT.id, ROLES.FRZ_TT_MM.id, ROLES.FRZ_MT_OOH.id]) {
      await ded(roleId, 'BAD_RETURN', 'Bad Return >0.4% to <0.5%',  0.4, 0.5, false, false, 10);
      await ded(roleId, 'BAD_RETURN', 'Bad Return >=0.5% to <=0.6%', 0.5, 0.6, true,  true,  20);
    }

    // ----- PRODUCTIVITY (AMB TT/MM, FRZ TT/MM) -----
    for (const roleId of [ROLES.AMB_TT_MM.id, ROLES.FRZ_TT_MM.id]) {
      await ded(roleId, 'PRODUCTIVITY', 'Productivity >80% to <=85%', 80, 85, false, true, 10);
      await ded(roleId, 'PRODUCTIVITY', 'Productivity <80%',          null, 80, false, false, 20);
    }

    // ----- JP ADHERENCE (AMB WS/MT, FRZ MT/OOH) -----
    for (const roleId of [ROLES.AMB_WS_MT.id, ROLES.FRZ_MT_OOH.id]) {
      await ded(roleId, 'JP_ADH', 'JP Adherence >=90% to <=95%', 90, 95, true,  true,  10);
      await ded(roleId, 'JP_ADH', 'JP Adherence >85% to <90%',   85, 90, false, false, 20);
    }

    // ----- SELECTED SKU DISTRIBUTION (AMB TT/MM, AMB WS/MT, FRZ TT/MM, FRZ MT/OOH) -----
    for (const roleId of [ROLES.AMB_TT_MM.id, ROLES.AMB_WS_MT.id, ROLES.FRZ_TT_MM.id, ROLES.FRZ_MT_OOH.id]) {
      await ded(roleId, 'SKU_DIST', 'Selected SKU >=95% to <100%', 95, 100, true,  false, 10);
      await ded(roleId, 'SKU_DIST', 'Selected SKU <95%',           null, 95, false, false, 20);
    }

    // ----- IMAGE RECOGNITION (FRZ TT/MM) -----
    await ded(ROLES.FRZ_TT_MM.id, 'IMAGE_REC', 'IR <90% to <=95%', null, 95, false, true, 10);

    // ----- NEW CUSTOMER ACQUISITION (AMB OOH) -----
    await ded(ROLES.AMB_OOH.id, 'NEW_CUST', 'New Customer >=85% to <95%', 85, 95, true, false, 10);
    await ded(ROLES.AMB_OOH.id, 'NEW_CUST', 'New Customer >=75% to <85%', 75, 85, true, false, 20);

    // ----- NUMBER OF INVOICED CUSTOMERS / SERVICE LEVEL (AMB OOH) -----
    await ded(ROLES.AMB_OOH.id, 'INV_CUST', 'Invoiced Customers >=70% to <80%', 70, 80, true, false, 10);
    await ded(ROLES.AMB_OOH.id, 'INV_CUST', 'Invoiced Customers >=60% to <70%', 60, 70, true, false, 20);

    await c.query('COMMIT');
    console.log('\n=== SADAFCO KSA 25 Salesman plan seeded ===');
    console.log('Plan ID:', PLAN_ID);
    console.log('\nRoles created/updated:');
    Object.values(ROLES).forEach(r => console.log('  -', r.id, '→', r.name));
    console.log('\nSlab groups:');
    console.log('  - 150/350 (per 1% achievement): AMB TT/MM, FRZ TT/MM, FRZ MT/OOH');
    console.log('  - 215/355 (per 1% achievement): AMB WS/MT, AMB OOH');
    console.log('\nDeduction rules: see kpi_deduction_rules where plan_id =', PLAN_ID);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('SEED FAILED:', e.message);
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
