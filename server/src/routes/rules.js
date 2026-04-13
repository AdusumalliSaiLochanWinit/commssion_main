import { Router } from 'express';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

const router = Router();

// Get all rules for a plan
router.get('/plan/:planId', async (req, res) => {
  try {
    const db = getDb();
    const ruleSets = await db.prepare('SELECT * FROM rule_sets WHERE plan_id = ?').all(req.params.planId);
    for (const rs of ruleSets) {
      rs.rules = await db.prepare('SELECT * FROM rules WHERE rule_set_id = ? ORDER BY priority').all(rs.id);
    }

    const eligibility = await db.prepare('SELECT * FROM eligibility_rules WHERE plan_id = ?').all(req.params.planId);
    const multipliers = await db.prepare('SELECT * FROM multiplier_rules WHERE plan_id = ?').all(req.params.planId);
    const penalties = await db.prepare('SELECT * FROM penalty_rules WHERE plan_id = ?').all(req.params.planId);
    const caps = await db.prepare('SELECT * FROM capping_rules WHERE plan_id = ?').all(req.params.planId);
    const splits = await db.prepare('SELECT * FROM split_rules WHERE plan_id = ?').all(req.params.planId);

    for (const s of splits) {
      s.participants = await db.prepare(`
        SELECT sp.*, r.name as role_name FROM split_participants sp
        JOIN roles r ON sp.role_id = r.id WHERE sp.split_rule_id = ?
      `).all(s.id);
    }

    res.json({ rule_sets: ruleSets, eligibility, multipliers, penalties, caps, splits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save eligibility rules
router.put('/eligibility/:planId', async (req, res) => {
  try {
    const db = getDb();
    const { rules } = req.body;

    await db.prepare('DELETE FROM eligibility_rules WHERE plan_id = ?').run(req.params.planId);
    const stmt = db.prepare(`INSERT INTO eligibility_rules (id, plan_id, metric, operator, threshold, action, reduction_percent, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of rules) {
      await stmt.run(uuid(), req.params.planId, r.metric, r.operator, r.threshold, r.action, r.reduction_percent || 0, r.is_active ? 1 : 0);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save multiplier rules
router.put('/multipliers/:planId', async (req, res) => {
  try {
    const db = getDb();
    const { rules } = req.body;

    await db.prepare('DELETE FROM multiplier_rules WHERE plan_id = ?').run(req.params.planId);
    const stmt = db.prepare(`INSERT INTO multiplier_rules (id, plan_id, name, type, condition_metric, condition_operator, condition_value, multiplier_value, stacking_mode, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of rules) {
      await stmt.run(uuid(), req.params.planId, r.name, r.type, r.condition_metric, r.condition_operator, r.condition_value, r.multiplier_value, r.stacking_mode, r.is_active ? 1 : 0);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save penalty rules
router.put('/penalties/:planId', async (req, res) => {
  try {
    const db = getDb();
    const { rules } = req.body;

    await db.prepare('DELETE FROM penalty_rules WHERE plan_id = ?').run(req.params.planId);
    const stmt = db.prepare(`INSERT INTO penalty_rules (id, plan_id, name, trigger_metric, trigger_operator, trigger_value, penalty_type, penalty_value, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of rules) {
      await stmt.run(uuid(), req.params.planId, r.name, r.trigger_metric, r.trigger_operator, r.trigger_value, r.penalty_type, r.penalty_value, r.is_active ? 1 : 0);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save capping rules
router.put('/caps/:planId', async (req, res) => {
  try {
    const db = getDb();
    const { rules } = req.body;

    await db.prepare('DELETE FROM capping_rules WHERE plan_id = ?').run(req.params.planId);
    const stmt = db.prepare(`INSERT INTO capping_rules (id, plan_id, cap_type, cap_value, is_active) VALUES (?, ?, ?, ?, ?)`);
    for (const r of rules) {
      await stmt.run(uuid(), req.params.planId, r.cap_type, r.cap_value, r.is_active ? 1 : 0);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save include/exclude rules
router.put('/rulesets/:planId', async (req, res) => {
  try {
    const db = getDb();
    const { rule_sets } = req.body;

    // Delete existing
    const existing = await db.prepare('SELECT id FROM rule_sets WHERE plan_id = ?').all(req.params.planId);
    for (const rs of existing) {
      await db.prepare('DELETE FROM rules WHERE rule_set_id = ?').run(rs.id);
    }
    await db.prepare('DELETE FROM rule_sets WHERE plan_id = ?').run(req.params.planId);

    for (const rs of rule_sets) {
      const rsId = uuid();
      await db.prepare('INSERT INTO rule_sets (id, plan_id, name, description) VALUES (?, ?, ?, ?)').run(rsId, req.params.planId, rs.name, rs.description);

      for (const rule of rs.rules || []) {
        await db.prepare(`INSERT INTO rules (id, rule_set_id, dimension, rule_type, match_type, match_values, priority)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(uuid(), rsId, rule.dimension, rule.rule_type, rule.match_type, JSON.stringify(rule.match_values), rule.priority || 0);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
