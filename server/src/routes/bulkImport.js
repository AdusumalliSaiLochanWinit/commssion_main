import { Router } from 'express';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

const router = Router();

/**
 * §22.9 Bulk Rule Upload — JSON-based import.
 * Client parses Excel locally (e.g. via SheetJS) and POSTs rows as JSON.
 *
 * Accepts both CSV-like arrays of objects AND a header+rows format:
 *   { "rows": [{...}, {...}] }
 *   OR { "headers": [...], "rows": [[...], [...]] }
 */
function normalizeRows(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.rows) && body.headers && Array.isArray(body.rows[0])) {
    // header+rows matrix → array of objects
    return body.rows.map(row => {
      const obj = {};
      body.headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
  }
  if (Array.isArray(body.rows)) return body.rows;
  return [];
}

// ---------- PRODUCTS BULK IMPORT ----------
router.post('/products', async (req, res) => {
  try {
    const db = getDb();
    const rows = normalizeRows(req.body);
    if (rows.length === 0) return res.status(400).json({ error: 'No rows provided' });

    const results = { inserted: 0, skipped: 0, errors: [] };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.sku || !r.name) { results.skipped++; continue; }
      try {
        const id = r.id || `prod-${r.sku}`;
        await db.prepare(`INSERT OR IGNORE INTO products (id, name, sku, category, subcategory, unit_price, is_strategic, is_new_launch, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, r.name, r.sku, r.category || 'Uncategorized', r.subcategory || null, Number(r.unit_price) || 0, r.is_strategic ? 1 : 0, r.is_new_launch ? 1 : 0, '[]');
        results.inserted++;
      } catch (e) {
        results.errors.push({ row: i + 1, error: e.message });
      }
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- CUSTOMERS BULK IMPORT ----------
router.post('/customers', async (req, res) => {
  try {
    const db = getDb();
    const rows = normalizeRows(req.body);
    if (rows.length === 0) return res.status(400).json({ error: 'No rows provided' });

    const results = { inserted: 0, skipped: 0, errors: [] };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.name || !r.channel) { results.skipped++; continue; }
      try {
        const id = r.id || `cust-${uuid().slice(0, 8)}`;
        await db.prepare(`INSERT OR IGNORE INTO customers (id, name, channel, channel_name, customer_group, customer_group_name, territory_id, credit_limit, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, r.name, r.channel, r.channel_name || null, r.customer_group || null, r.customer_group_name || null, r.territory_id || null, Number(r.credit_limit) || 0, '[]');
        results.inserted++;
      } catch (e) {
        results.errors.push({ row: i + 1, error: e.message });
      }
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- TERRITORIES BULK IMPORT ----------
router.post('/territories', async (req, res) => {
  try {
    const db = getDb();
    const rows = normalizeRows(req.body);
    const results = { inserted: 0, skipped: 0, errors: [] };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.id || !r.name || !r.type) { results.skipped++; continue; }
      try {
        await db.prepare(`INSERT OR IGNORE INTO territories (id, name, type, parent_id) VALUES (?, ?, ?, ?)`)
          .run(r.id, r.name, r.type, r.parent_id || null);
        results.inserted++;
      } catch (e) { results.errors.push({ row: i + 1, error: e.message }); }
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- EMPLOYEES BULK IMPORT ----------
router.post('/employees', async (req, res) => {
  try {
    const db = getDb();
    const rows = normalizeRows(req.body);
    const results = { inserted: 0, skipped: 0, errors: [] };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.name || !r.email || !r.role_id) { results.skipped++; continue; }
      try {
        const id = r.id || `emp-${uuid().slice(0, 8)}`;
        await db.prepare(`INSERT OR IGNORE INTO employees (id, name, email, external_id, role_id, territory_id, reports_to, base_salary, hire_date, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, r.name, r.email, r.external_id || null, r.role_id, r.territory_id || null, r.reports_to || null, Number(r.base_salary) || 0, r.hire_date || '2024-01-01', r.is_active !== false ? 1 : 0);
        results.inserted++;
      } catch (e) { results.errors.push({ row: i + 1, error: e.message }); }
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- INCLUDE/EXCLUDE RULES BULK IMPORT (§22.9 core requirement) ----------
router.post('/rules', async (req, res) => {
  try {
    const db = getDb();
    const { rule_set_id, rules } = req.body;
    if (!rule_set_id) return res.status(400).json({ error: 'rule_set_id required' });
    if (!Array.isArray(rules)) return res.status(400).json({ error: 'rules must be an array' });

    // Verify rule set exists
    const rs = await db.prepare('SELECT id FROM rule_sets WHERE id = ?').get(rule_set_id);
    if (!rs) return res.status(404).json({ error: 'Rule set not found' });

    const results = { inserted: 0, skipped: 0, errors: [] };
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (!r.dimension || !r.rule_type) { results.skipped++; continue; }
      try {
        const id = r.id || uuid();
        const matchVals = typeof r.match_values === 'string' ? r.match_values : JSON.stringify(r.match_values || []);
        const condLogic = r.conditional_logic
          ? (typeof r.conditional_logic === 'string' ? r.conditional_logic : JSON.stringify(r.conditional_logic))
          : null;
        await db.prepare(`INSERT OR REPLACE INTO rules (id, rule_set_id, dimension, rule_type, match_type, match_values, priority, valid_from, valid_to, conditional_logic, parent_rule_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, rule_set_id, r.dimension, r.rule_type, r.match_type || 'exact', matchVals, Number(r.priority) || i, r.valid_from || null, r.valid_to || null, condLogic, r.parent_rule_id || null);
        results.inserted++;
      } catch (e) { results.errors.push({ row: i + 1, error: e.message }); }
    }

    // Audit trail for rule upload (§22.12)
    await db.prepare(`INSERT INTO audit_trail (id, entity_type, entity_id, action, changes, performed_by) VALUES (?, 'rule_set', ?, 'bulk_upload', ?, ?)`)
      .run(uuid(), rule_set_id, JSON.stringify({ count: results.inserted }), req.body.uploaded_by || 'admin');

    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- TAGS BULK APPLY ----------
router.post('/tags', async (req, res) => {
  try {
    const db = getDb();
    // Body: { assignments: [{ tag_id, entity_type, entity_id, valid_from?, valid_to? }] }
    const assignments = req.body.assignments || normalizeRows(req.body);
    const results = { inserted: 0, skipped: 0, errors: [] };
    for (let i = 0; i < assignments.length; i++) {
      const a = assignments[i];
      if (!a.tag_id || !a.entity_type || !a.entity_id) { results.skipped++; continue; }
      try {
        await db.prepare(`INSERT OR REPLACE INTO entity_tags (id, tag_id, entity_type, entity_id, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(uuid(), a.tag_id, a.entity_type, a.entity_id, a.valid_from || null, a.valid_to || null);
        results.inserted++;
      } catch (e) { results.errors.push({ row: i + 1, error: e.message }); }
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- EVENTS BULK IMPORT ----------
router.post('/events', async (req, res) => {
  try {
    const db = getDb();
    const rows = normalizeRows(req.body);
    const results = { inserted: 0, skipped: 0, errors: [] };
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.event_type || !r.employee_id || !r.event_date || !r.period) { results.skipped++; continue; }
      try {
        const id = r.id || uuid();
        const metadata = r.metadata
          ? (typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata))
          : '{}';
        await db.prepare(`INSERT INTO commission_events (id, event_type, employee_id, reference_id, reference_type, value, metadata, event_date, period, validated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, r.event_type, r.employee_id, r.reference_id || null, r.reference_type || null, Number(r.value) || 0, metadata, r.event_date, r.period, r.validated ? 1 : 0);
        results.inserted++;
      } catch (e) { results.errors.push({ row: i + 1, error: e.message }); }
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- TRANSACTIONS BULK IMPORT ----------
router.post('/transactions', async (req, res) => {
  try {
    const db = getDb();
    const rows = normalizeRows(req.body);
    const results = { inserted: 0, skipped: 0, errors: [] };
    const stmts = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.employee_id || !r.customer_id || !r.product_id || !r.period) { results.skipped++; continue; }
      stmts.push({
        sql: `INSERT OR IGNORE INTO transactions (id, employee_id, customer_id, product_id, transaction_type, quantity, amount, transaction_date, period, territory_id, currency, exchange_rate, base_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [r.id || uuid(), r.employee_id, r.customer_id, r.product_id, r.transaction_type || 'sale', Number(r.quantity) || 0, Number(r.amount) || 0, r.transaction_date, r.period, r.territory_id || null, r.currency || 'AED', Number(r.exchange_rate) || 1, Number(r.base_amount ?? r.amount) || 0],
      });
    }
    // Batch in chunks of 80
    for (let i = 0; i < stmts.length; i += 80) {
      try {
        await db.batch(stmts.slice(i, i + 80));
        results.inserted += Math.min(80, stmts.length - i);
      } catch (e) {
        results.errors.push({ batch: i, error: e.message });
      }
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- SAMPLE TEMPLATES (help clients know the format) ----------
router.get('/templates/:entity', (req, res) => {
  const templates = {
    products: { headers: ['id', 'name', 'sku', 'category', 'subcategory', 'unit_price', 'is_strategic', 'is_new_launch'], sample: { name: 'Chocolate Bar', sku: 'SKU-001', category: 'Confectionery', unit_price: 5.5 } },
    customers: { headers: ['id', 'name', 'channel', 'channel_name', 'customer_group', 'territory_id', 'credit_limit'], sample: { name: 'Lulu Hypermarket', channel: 'KH', territory_id: 'terr-rt-101' } },
    employees: { headers: ['id', 'name', 'email', 'external_id', 'role_id', 'territory_id', 'reports_to', 'base_salary', 'hire_date'], sample: { name: 'John Doe', email: 'john@co.com', role_id: 'role-pre-sales', territory_id: 'terr-rt-101', base_salary: 5000 } },
    rules: { headers: ['dimension', 'rule_type', 'match_type', 'match_values', 'priority', 'valid_from', 'valid_to', 'conditional_logic', 'parent_rule_id'], sample: { dimension: 'product_category', rule_type: 'include', match_type: 'exact', match_values: ['BREAD', 'CAKES'], valid_from: '2026-01-01', valid_to: '2026-12-31' } },
    tags: { headers: ['tag_id', 'entity_type', 'entity_id', 'valid_from', 'valid_to'], sample: { tag_id: 'tag-strategic', entity_type: 'product', entity_id: 'prod-001' } },
    events: { headers: ['event_type', 'employee_id', 'reference_id', 'value', 'event_date', 'period', 'validated'], sample: { event_type: 'delivery_confirmation', employee_id: 'emp-001', event_date: '2026-01-15', period: '2026-01', validated: true } },
    transactions: { headers: ['employee_id', 'customer_id', 'product_id', 'transaction_type', 'quantity', 'amount', 'transaction_date', 'period', 'currency'], sample: { employee_id: 'emp-001', customer_id: 'cust-001', product_id: 'prod-001', transaction_type: 'sale', quantity: 10, amount: 350, transaction_date: '2026-01-15', period: '2026-01', currency: 'AED' } },
  };
  const t = templates[req.params.entity];
  if (!t) return res.status(404).json({ error: 'Unknown entity', available: Object.keys(templates) });
  res.json(t);
});

export default router;
