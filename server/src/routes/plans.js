import { Router } from 'express';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

const router = Router();

// List all plans
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    // Single query with subqueries to avoid N+1 roundtrips to remote DB
    const plans = await db.prepare(`
      SELECT cp.*,
        COALESCE((SELECT COUNT(*) FROM plan_kpis WHERE plan_id = cp.id), 0) as kpi_count,
        COALESCE((SELECT COUNT(*) FROM plan_territories WHERE plan_id = cp.id), 0) as territory_count
      FROM commission_plans cp
      ORDER BY cp.created_at DESC
    `).all();

    // Fetch all plan-role mappings in one query
    const allRoles = await db.prepare(`
      SELECT pr.plan_id, r.id, r.name FROM plan_roles pr
      JOIN roles r ON pr.role_id = r.id
    `).all();
    const rolesByPlan = {};
    for (const r of allRoles) {
      if (!rolesByPlan[r.plan_id]) rolesByPlan[r.plan_id] = [];
      rolesByPlan[r.plan_id].push({ id: r.id, name: r.name });
    }

    const enriched = plans.map(plan => ({
      ...plan,
      roles: rolesByPlan[plan.id] || [],
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single plan with all config
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const plan = await db.prepare('SELECT * FROM commission_plans WHERE id = ?').get(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    // Roles
    plan.roles = await db.prepare(`
      SELECT r.* FROM plan_roles pr JOIN roles r ON pr.role_id = r.id WHERE pr.plan_id = ?
    `).all(plan.id);

    // Territories
    plan.territories = await db.prepare(`
      SELECT t.* FROM plan_territories pt JOIN territories t ON pt.territory_id = t.id WHERE pt.plan_id = ?
    `).all(plan.id);

    // KPIs with slab config
    plan.kpis = await db.prepare(`
      SELECT pk.*, k.name as kpi_name, k.code as kpi_code, k.category as kpi_category,
             k.formula, k.unit, k.direction
      FROM plan_kpis pk
      JOIN kpi_definitions k ON pk.kpi_id = k.id
      WHERE pk.plan_id = ?
    `).all(plan.id);

    // Slab sets and tiers
    plan.slab_sets = await db.prepare(`
      SELECT ss.*, r.name as role_name
      FROM slab_sets ss
      LEFT JOIN roles r ON r.id = ss.role_id
      WHERE ss.plan_id = ?
    `).all(plan.id);
    for (const ss of plan.slab_sets) {
      ss.tiers = await db.prepare('SELECT * FROM slab_tiers WHERE slab_set_id = ? ORDER BY tier_order').all(ss.id);
    }

    // Rules
    plan.rule_sets = await db.prepare('SELECT * FROM rule_sets WHERE plan_id = ?').all(plan.id);
    for (const rs of plan.rule_sets) {
      rs.rules = await db.prepare('SELECT * FROM rules WHERE rule_set_id = ?').all(rs.id);
    }

    // Eligibility
    plan.eligibility_rules = await db.prepare('SELECT * FROM eligibility_rules WHERE plan_id = ?').all(plan.id);

    // Multipliers
    plan.multiplier_rules = await db.prepare('SELECT * FROM multiplier_rules WHERE plan_id = ?').all(plan.id);

    // KPI deductions
    plan.kpi_deduction_rules = await db.prepare(`
      SELECT kdr.*, kd.name as kpi_name, kd.code as kpi_code, r.name as role_name
      FROM kpi_deduction_rules kdr
      LEFT JOIN kpi_definitions kd ON kd.id = kdr.kpi_id
      LEFT JOIN roles r ON r.id = kdr.role_id
      WHERE kdr.plan_id = ?
      ORDER BY kdr.priority, kdr.created_at
    `).all(plan.id);

    // Penalties
    plan.penalty_rules = await db.prepare('SELECT * FROM penalty_rules WHERE plan_id = ?').all(plan.id);

    // Monthly KPI targets
    plan.monthly_targets = await db.prepare(`
      SELECT t.*, k.name as kpi_name, k.code as kpi_code, r.name as role_name
      FROM plan_kpi_monthly_targets t
      JOIN kpi_definitions k ON k.id = t.kpi_id
      LEFT JOIN roles r ON r.id = t.role_id
      WHERE t.plan_id = ?
      ORDER BY t.period, t.kpi_id
    `).all(plan.id);

    // Optional fixed incentives
    plan.fixed_incentives = await db.prepare(`
      SELECT fi.*, k.name as condition_kpi_name, r.name as role_name
      FROM plan_fixed_incentives fi
      LEFT JOIN kpi_definitions k ON k.id = fi.condition_kpi_id
      LEFT JOIN roles r ON r.id = fi.role_id
      WHERE fi.plan_id = ?
      ORDER BY fi.period, fi.name
    `).all(plan.id);

    // Caps
    plan.capping_rules = await db.prepare('SELECT * FROM capping_rules WHERE plan_id = ?').all(plan.id);

    // Splits
    plan.split_rules = await db.prepare('SELECT * FROM split_rules WHERE plan_id = ?').all(plan.id);
    for (const sr of plan.split_rules) {
      sr.participants = await db.prepare(`
        SELECT sp.*, r.name as role_name
        FROM split_participants sp
        JOIN roles r ON sp.role_id = r.id
        WHERE sp.split_rule_id = ?
      `).all(sr.id);
    }

    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create plan
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const id = uuid();
    const { name, description, plan_type, effective_from, effective_to, base_payout, created_by } = req.body;

    await db.prepare(`
      INSERT INTO commission_plans (id, name, description, plan_type, effective_from, effective_to, base_payout, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, description, plan_type || 'monthly', effective_from, effective_to, base_payout || 0, created_by);

    // Add audit trail
    await db.prepare(`INSERT INTO audit_trail (id, entity_type, entity_id, action, changes, performed_by)
      VALUES (?, 'plan', ?, 'created', ?, ?)`).run(uuid(), id, JSON.stringify({ name }), created_by);

    const plan = await db.prepare('SELECT * FROM commission_plans WHERE id = ?').get(id);
    res.status(201).json(plan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update plan
router.put('/:id', async (req, res) => {
  try {
    const db = getDb();
    const plan = await db.prepare('SELECT * FROM commission_plans WHERE id = ?').get(req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const { name, description, status, plan_type, effective_from, effective_to, base_payout } = req.body;

    await db.prepare(`
      UPDATE commission_plans SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        status = COALESCE(?, status),
        plan_type = COALESCE(?, plan_type),
        effective_from = COALESCE(?, effective_from),
        effective_to = COALESCE(?, effective_to),
        base_payout = COALESCE(?, base_payout),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(name, description, status, plan_type, effective_from, effective_to, base_payout, req.params.id);

    // Audit
    await db.prepare(`INSERT INTO audit_trail (id, entity_type, entity_id, action, changes, performed_by)
      VALUES (?, 'plan', ?, 'updated', ?, ?)`).run(uuid(), req.params.id, JSON.stringify(req.body), req.body.updated_by);

    const updated = await db.prepare('SELECT * FROM commission_plans WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update plan roles
router.put('/:id/roles', async (req, res) => {
  try {
    const db = getDb();
    const { role_ids } = req.body;

    await db.prepare('DELETE FROM plan_roles WHERE plan_id = ?').run(req.params.id);
    const stmt = db.prepare('INSERT INTO plan_roles (id, plan_id, role_id) VALUES (?, ?, ?)');
    for (const roleId of role_ids) {
      await stmt.run(uuid(), req.params.id, roleId);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update plan territories
router.put('/:id/territories', async (req, res) => {
  try {
    const db = getDb();
    const { territory_ids } = req.body;

    await db.prepare('DELETE FROM plan_territories WHERE plan_id = ?').run(req.params.id);
    const stmt = db.prepare('INSERT INTO plan_territories (id, plan_id, territory_id) VALUES (?, ?, ?)');
    for (const tid of territory_ids) {
      await stmt.run(uuid(), req.params.id, tid);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update plan KPIs
router.put('/:id/kpis', async (req, res) => {
  try {
    const db = getDb();
    const { kpis } = req.body;

    await db.prepare('DELETE FROM plan_kpis WHERE plan_id = ?').run(req.params.id);
    const stmt = db.prepare('INSERT INTO plan_kpis (id, plan_id, kpi_id, weight, target_value, slab_set_id) VALUES (?, ?, ?, ?, ?, ?)');
    for (const kpi of kpis) {
      await stmt.run(uuid(), req.params.id, kpi.kpi_id, kpi.weight, kpi.target_value, kpi.slab_set_id || null);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update plan slabs
router.put('/:id/slabs', async (req, res) => {
  try {
    const db = getDb();
    const { slab_sets } = req.body;
    const planId = req.params.id;

    // Delete existing slab tiers and sets for this plan
    const existingSets = await db.prepare('SELECT id FROM slab_sets WHERE plan_id = ?').all(planId);
    for (const s of existingSets) {
      await db.prepare('DELETE FROM slab_tiers WHERE slab_set_id = ?').run(s.id);
    }
    await db.prepare('DELETE FROM slab_sets WHERE plan_id = ?').run(planId);

    // Insert new
    const setStmt = db.prepare('INSERT INTO slab_sets (id, name, type, plan_id, kpi_id, role_id) VALUES (?, ?, ?, ?, ?, ?)');
    const tierStmt = db.prepare('INSERT INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type, min_inclusive, max_inclusive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');

    for (const ss of (slab_sets || [])) {
      const ssId = uuid();
      await setStmt.run(ssId, ss.name, ss.type || 'step', planId, ss.kpi_id || null, ss.role_id || null);
      for (const [i, tier] of (ss.tiers || []).entries()) {
        await tierStmt.run(
          uuid(),
          ssId,
          tier.tier_order ?? i + 1,
          tier.min_percent,
          tier.max_percent ?? null,
          tier.rate,
          tier.rate_type || 'percentage',
          tier.min_inclusive === undefined ? 1 : (tier.min_inclusive ? 1 : 0),
          tier.max_inclusive === undefined ? 0 : (tier.max_inclusive ? 1 : 0),
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update plan rules
router.put('/:id/rules', async (req, res) => {
  try {
    const db = getDb();
    const { rule_sets } = req.body;
    const planId = req.params.id;

    const existingSets = await db.prepare('SELECT id FROM rule_sets WHERE plan_id = ?').all(planId);
    for (const s of existingSets) {
      await db.prepare('DELETE FROM rules WHERE rule_set_id = ?').run(s.id);
    }
    await db.prepare('DELETE FROM rule_sets WHERE plan_id = ?').run(planId);

    const setStmt = db.prepare('INSERT INTO rule_sets (id, plan_id, name, description) VALUES (?, ?, ?, ?)');
    const ruleStmt = db.prepare('INSERT INTO rules (id, rule_set_id, dimension, rule_type, match_type, match_values, priority) VALUES (?, ?, ?, ?, ?, ?, ?)');

    for (const rs of (rule_sets || [])) {
      const rsId = uuid();
      await setStmt.run(rsId, planId, rs.name, rs.description || null);
      for (const [i, rule] of (rs.rules || []).entries()) {
        await ruleStmt.run(uuid(), rsId, rule.dimension, rule.rule_type, rule.match_type || 'exact', JSON.stringify(rule.match_values || []), rule.priority ?? i);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update eligibility rules
router.put('/:id/eligibility', async (req, res) => {
  try {
    const db = getDb();
    const { rules } = req.body;
    const planId = req.params.id;

    await db.prepare('DELETE FROM eligibility_rules WHERE plan_id = ?').run(planId);
    const stmt = db.prepare('INSERT INTO eligibility_rules (id, plan_id, metric, operator, threshold, action, reduction_percent) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const r of (rules || [])) {
      await stmt.run(uuid(), planId, r.metric, r.operator || '>=', r.threshold, r.action || 'zero_payout', r.reduction_percent || 0);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update multiplier rules
router.put('/:id/multipliers', async (req, res) => {
  try {
    const db = getDb();
    const { rules } = req.body;
    const planId = req.params.id;

    await db.prepare('DELETE FROM multiplier_rules WHERE plan_id = ?').run(planId);
    const stmt = db.prepare('INSERT INTO multiplier_rules (id, plan_id, name, type, condition_metric, condition_operator, condition_value, multiplier_value, stacking_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of (rules || [])) {
      await stmt.run(uuid(), planId, r.name, r.type, r.condition_metric, r.condition_operator || '>=', r.condition_value, r.multiplier_value || 1.0, r.stacking_mode || 'multiplicative');
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update KPI deduction rules (PDF-style KPI non-achievement deductions)
router.put('/:id/kpi-deductions', async (req, res) => {
  try {
    const db = getDb();
    const { rules } = req.body;
    const planId = req.params.id;

    await db.prepare('DELETE FROM kpi_deduction_rules WHERE plan_id = ?').run(planId);
    const stmt = db.prepare(`
      INSERT INTO kpi_deduction_rules (
        id, plan_id, kpi_id, role_id, name, metric_type, min_value, max_value,
        min_inclusive, max_inclusive, deduction_percent, priority, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [idx, r] of (rules || []).entries()) {
      await stmt.run(
        uuid(),
        planId,
        r.kpi_id || null,
        r.role_id || null,
        r.name || `KPI deduction ${idx + 1}`,
        r.metric_type || 'shortfall_percent',
        r.min_value ?? null,
        r.max_value ?? null,
        r.min_inclusive === undefined ? 1 : (r.min_inclusive ? 1 : 0),
        r.max_inclusive === undefined ? 1 : (r.max_inclusive ? 1 : 0),
        r.deduction_percent || 0,
        r.priority ?? idx,
        r.is_active === undefined ? 1 : (r.is_active ? 1 : 0),
      );
    }

    res.json({ success: true, count: (rules || []).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update monthly KPI targets
router.put('/:id/monthly-targets', async (req, res) => {
  try {
    const db = getDb();
    const { targets } = req.body;
    const planId = req.params.id;
    await db.prepare('DELETE FROM plan_kpi_monthly_targets WHERE plan_id = ?').run(planId);
    const stmt = db.prepare(`
      INSERT INTO plan_kpi_monthly_targets (id, plan_id, kpi_id, role_id, period, target_value)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const t of (targets || [])) {
      await stmt.run(uuid(), planId, t.kpi_id, t.role_id || null, t.period, t.target_value);
    }
    res.json({ success: true, count: (targets || []).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update optional fixed incentives
router.put('/:id/fixed-incentives', async (req, res) => {
  try {
    const db = getDb();
    const { incentives } = req.body;
    const planId = req.params.id;
    await db.prepare('DELETE FROM plan_fixed_incentives WHERE plan_id = ?').run(planId);
    const stmt = db.prepare(`
      INSERT INTO plan_fixed_incentives (
        id, plan_id, role_id, period, name, amount, condition_kpi_id, condition_operator, condition_value, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const i of (incentives || [])) {
      await stmt.run(
        uuid(), planId, i.role_id || null, i.period || null, i.name, i.amount || 0,
        i.condition_kpi_id || null, i.condition_operator || '>=', i.condition_value ?? null,
        i.is_active === undefined ? 1 : (i.is_active ? 1 : 0),
      );
    }
    res.json({ success: true, count: (incentives || []).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Load KSA 2025 policy preset from PDF into a plan
router.post('/:id/load-ksa-2025', async (req, res) => {
  try {
    const db = getDb();
    const planId = req.params.id;

    const kpiByCode = {};
    for (const k of await db.prepare('SELECT id, code FROM kpi_definitions').all()) kpiByCode[k.code] = k.id;

    // Clear existing configurable sets
    const existingSets = await db.prepare('SELECT id FROM slab_sets WHERE plan_id = ?').all(planId);
    for (const s of existingSets) await db.prepare('DELETE FROM slab_tiers WHERE slab_set_id = ?').run(s.id);
    await db.prepare('DELETE FROM slab_sets WHERE plan_id = ?').run(planId);
    await db.prepare('DELETE FROM kpi_deduction_rules WHERE plan_id = ?').run(planId);
    await db.prepare('DELETE FROM plan_kpis WHERE plan_id = ?').run(planId);
    const existingRuleSets = await db.prepare('SELECT id FROM rule_sets WHERE plan_id = ?').all(planId);
    for (const rs of existingRuleSets) await db.prepare('DELETE FROM rules WHERE rule_set_id = ?').run(rs.id);
    await db.prepare('DELETE FROM rule_sets WHERE plan_id = ?').run(planId);

    const slabSetStmt = db.prepare('INSERT INTO slab_sets (id, name, type, plan_id, kpi_id, role_id) VALUES (?, ?, ?, ?, ?, ?)');
    const slabTierStmt = db.prepare('INSERT INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type, min_inclusive, max_inclusive) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const planKpiStmt = db.prepare('INSERT INTO plan_kpis (id, plan_id, kpi_id, weight, target_value, slab_set_id) VALUES (?, ?, ?, ?, ?, ?)');

    const salesKpi = kpiByCode.TOTAL_REVENUE;
    // Note: PDF slabs end at <=105%. In practice, achievement can exceed 105%.
    // We model this by adding an open-ended tier (>105%) at the same rate as slab 2,
    // so high performers still get the slab-2 payout.
    const slabGroups = [
      { name: 'KSA Sales Ach - AMB TT/MM & FRZ', role_ids: ['role-salesman', 'role-van-sales', 'role-van-driver'], tiers: [
        { min: 85, max: 95, rate: 150, minIn: 0, maxIn: 1 },
        { min: 95, max: 105, rate: 350, minIn: 0, maxIn: 1 },
        { min: 105, max: null, rate: 350, minIn: 0, maxIn: 0 },
      ] },
      { name: 'KSA Sales Ach - AMB WS/MT/OOH', role_ids: ['role-pre-sales', 'role-ka-exec'], tiers: [
        { min: 85, max: 100, rate: 215, minIn: 0, maxIn: 1 },
        { min: 100, max: 105, rate: 355, minIn: 0, maxIn: 1 },
        { min: 105, max: null, rate: 355, minIn: 0, maxIn: 0 },
      ] },
      { name: 'KSA Sales Ach - Supervisor', role_ids: ['role-ss', 'role-route-sup'], tiers: [
        { min: 85, max: 95, rate: 300, minIn: 0, maxIn: 1 },
        { min: 95, max: 105, rate: 375, minIn: 0, maxIn: 1 },
        { min: 105, max: null, rate: 375, minIn: 0, maxIn: 0 },
      ] },
      { name: 'KSA Sales Ach - ASM', role_ids: ['role-asm'], tiers: [
        { min: 85, max: 95, rate: 350, minIn: 0, maxIn: 1 },
        { min: 95, max: 105, rate: 535, minIn: 0, maxIn: 1 },
        { min: 105, max: null, rate: 535, minIn: 0, maxIn: 0 },
      ] },
    ];

    for (const group of slabGroups) {
      for (const roleId of group.role_ids) {
        const setId = uuid();
        await slabSetStmt.run(setId, group.name, 'step', planId, salesKpi, roleId);
        let order = 1;
        for (const t of group.tiers) {
          await slabTierStmt.run(uuid(), setId, order++, t.min, t.max, t.rate, 'per_achievement_point', t.minIn, t.maxIn);
        }
      }
    }

    // Plan KPI mapping: sales KPI drives payout, others drive deduction checks.
    const salesTarget = 100000;
    if (salesKpi) {
      await planKpiStmt.run(uuid(), planId, salesKpi, 100, salesTarget, null);
    }
    const monitorOnlyKpis = [
      'OVERDUE_PCT',
      'RETURN_PERCENT',
      'ROUTE_ADHERENCE',
      'PRODUCTIVE_CALLS',
      'SKU_PENETRATION',
      'IMAGE_VERIFY',
      'ZERO_SALES_OUTLET',
      'OTD_PERCENT',
      'NEW_CUSTOMERS',
      'INV_DELIVERED',
    ];
    for (const code of monitorOnlyKpis) {
      const id = kpiByCode[code];
      if (!id) continue;
      await planKpiStmt.run(uuid(), planId, id, 0, 100, null);
    }

    const kpiDedStmt = db.prepare(`
      INSERT INTO kpi_deduction_rules (
        id, plan_id, kpi_id, role_id, name, metric_type, min_value, max_value,
        min_inclusive, max_inclusive, deduction_percent, priority, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    const addDed = async ({ code, name, min, max, minIn, maxIn, pct, priority = 1, roleId = null }) => {
      const kpiId = kpiByCode[code];
      if (!kpiId) return;
      await kpiDedStmt.run(uuid(), planId, kpiId, roleId, name, 'actual_value', min, max, minIn ? 1 : 0, maxIn ? 1 : 0, pct, priority);
    };

    // Overdue / Bad return / JP adherence / Productivity / Distribution / IR / Zero-sales style deductions
    await addDed({ code: 'OVERDUE_PCT', name: 'Overdue >7 to <9', min: 7, max: 9, minIn: false, maxIn: false, pct: 10, priority: 1 });
    await addDed({ code: 'OVERDUE_PCT', name: 'Overdue >=9 to <=12', min: 9, max: 12, minIn: true, maxIn: true, pct: 20, priority: 2 });
    await addDed({ code: 'RETURN_PERCENT', name: 'Bad Return >0.4 to <0.5', min: 0.4, max: 0.5, minIn: false, maxIn: false, pct: 10, priority: 1 });
    await addDed({ code: 'RETURN_PERCENT', name: 'Bad Return >=0.5 to <=0.6', min: 0.5, max: 0.6, minIn: true, maxIn: true, pct: 20, priority: 2 });
    await addDed({ code: 'ROUTE_ADHERENCE', name: 'JP Adherence >=90 to <=95', min: 90, max: 95, minIn: true, maxIn: true, pct: 10, priority: 1 });
    await addDed({ code: 'ROUTE_ADHERENCE', name: 'JP Adherence >85 to <90', min: 85, max: 90, minIn: false, maxIn: false, pct: 20, priority: 2 });
    await addDed({ code: 'PRODUCTIVE_CALLS', name: 'Productivity >80 to <=85', min: 80, max: 85, minIn: false, maxIn: true, pct: 10, priority: 1 });
    await addDed({ code: 'PRODUCTIVE_CALLS', name: 'Productivity <80', min: null, max: 80, minIn: false, maxIn: false, pct: 20, priority: 2 });
    await addDed({ code: 'SKU_PENETRATION', name: 'Selected SKU >=85 to <95', min: 85, max: 95, minIn: true, maxIn: false, pct: 10, priority: 1 });
    await addDed({ code: 'SKU_PENETRATION', name: 'Selected SKU >=75 to <85', min: 75, max: 85, minIn: true, maxIn: false, pct: 20, priority: 2 });
    await addDed({ code: 'IMAGE_VERIFY', name: 'IR <90 to <=95', min: 90, max: 95, minIn: false, maxIn: true, pct: 10, priority: 1 });
    await addDed({ code: 'ZERO_SALES_OUTLET', name: 'Zero Sales Customers >=6', min: 6, max: null, minIn: true, maxIn: false, pct: 10, priority: 1 });
    await addDed({ code: 'OTD_PERCENT', name: 'Service Level >=70 to <80', min: 70, max: 80, minIn: true, maxIn: false, pct: 10, priority: 1 });
    await addDed({ code: 'OTD_PERCENT', name: 'Service Level >=60 to <70', min: 60, max: 70, minIn: true, maxIn: false, pct: 20, priority: 2 });

    res.json({ success: true, message: 'KSA 2025 policy template loaded', plan_id: planId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update penalty rules
router.put('/:id/penalties', async (req, res) => {
  try {
    const db = getDb();
    const { rules } = req.body;
    const planId = req.params.id;

    await db.prepare('DELETE FROM penalty_rules WHERE plan_id = ?').run(planId);
    const stmt = db.prepare('INSERT INTO penalty_rules (id, plan_id, name, trigger_metric, trigger_operator, trigger_value, penalty_type, penalty_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of (rules || [])) {
      await stmt.run(uuid(), planId, r.name, r.trigger_metric, r.trigger_operator || '>', r.trigger_value, r.penalty_type || 'percentage', r.penalty_value || 0);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update capping rules
router.put('/:id/caps', async (req, res) => {
  try {
    const db = getDb();
    const { rules } = req.body;
    const planId = req.params.id;

    await db.prepare('DELETE FROM capping_rules WHERE plan_id = ?').run(planId);
    const stmt = db.prepare('INSERT INTO capping_rules (id, plan_id, cap_type, cap_value) VALUES (?, ?, ?, ?)');
    for (const r of (rules || [])) {
      await stmt.run(uuid(), planId, r.cap_type, r.cap_value);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update split rules
router.put('/:id/splits', async (req, res) => {
  try {
    const db = getDb();
    const { rules } = req.body;
    const planId = req.params.id;

    const existingSplits = await db.prepare('SELECT id FROM split_rules WHERE plan_id = ?').all(planId);
    for (const s of existingSplits) {
      await db.prepare('DELETE FROM split_participants WHERE split_rule_id = ?').run(s.id);
    }
    await db.prepare('DELETE FROM split_rules WHERE plan_id = ?').run(planId);

    const splitStmt = db.prepare('INSERT INTO split_rules (id, plan_id, name, trigger_condition) VALUES (?, ?, ?, ?)');
    const partStmt = db.prepare('INSERT INTO split_participants (id, split_rule_id, role_id, split_percent) VALUES (?, ?, ?, ?)');

    for (const sr of (rules || [])) {
      const srId = uuid();
      await splitStmt.run(srId, planId, sr.name, sr.trigger_condition || null);
      for (const p of (sr.participants || [])) {
        await partStmt.run(uuid(), srId, p.role_id, p.split_percent);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
