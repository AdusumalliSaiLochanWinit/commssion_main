import { Router } from 'express';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

const router = Router();

const VALID_FORMULA_TYPES = ['simple', 'ratio', 'growth', 'team', 'static'];

function validateFormula(formulaStr) {
  if (!formulaStr) return true; // allow empty for legacy
  try {
    const f = typeof formulaStr === 'string' ? JSON.parse(formulaStr) : formulaStr;
    if (!f || typeof f !== 'object') return false;
    return VALID_FORMULA_TYPES.includes(f.type);
  } catch {
    return true; // allow legacy text formulas
  }
}

router.get('/', async (req, res) => {
  try {
    const db = getDb();
    let query = 'SELECT * FROM kpi_definitions WHERE is_active = 1';
    const params = [];

    if (req.query.category) {
      query += ' AND category = ?';
      params.push(req.query.category);
    }

    query += ' ORDER BY category, name';
    const kpis = await db.prepare(query).all(...params);
    res.json(kpis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const db = getDb();
    const categories = await db.prepare('SELECT DISTINCT category FROM kpi_definitions ORDER BY category').all();
    res.json(categories.map(c => c.category));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const kpi = await db.prepare('SELECT * FROM kpi_definitions WHERE id = ?').get(req.params.id);
    if (!kpi) return res.status(404).json({ error: 'KPI not found' });
    res.json(kpi);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const id = uuid();
    const { name, code, category, description, formula, unit, direction, applicable_roles } = req.body;

    if (formula && !validateFormula(formula)) {
      return res.status(400).json({ error: 'Invalid formula: must be valid JSON with a recognized type (simple, ratio, growth, team, static)' });
    }

    await db.prepare(`
      INSERT INTO kpi_definitions (id, name, code, category, description, formula, unit, direction, applicable_roles)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, code, category, description, formula, unit || 'currency', direction || 'higher_is_better', JSON.stringify(applicable_roles || []));

    const kpi = await db.prepare('SELECT * FROM kpi_definitions WHERE id = ?').get(id);
    res.status(201).json(kpi);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const db = getDb();
    const kpi = await db.prepare('SELECT * FROM kpi_definitions WHERE id = ?').get(req.params.id);
    if (!kpi) return res.status(404).json({ error: 'KPI not found' });

    const { name, code, category, description, formula, unit, direction, applicable_roles } = req.body;

    if (formula && !validateFormula(formula)) {
      return res.status(400).json({ error: 'Invalid formula: must be valid JSON with a recognized type (simple, ratio, growth, team, static)' });
    }

    await db.prepare(`
      UPDATE kpi_definitions SET
        name = COALESCE(?, name),
        code = COALESCE(?, code),
        category = COALESCE(?, category),
        description = COALESCE(?, description),
        formula = COALESCE(?, formula),
        unit = COALESCE(?, unit),
        direction = COALESCE(?, direction),
        applicable_roles = COALESCE(?, applicable_roles)
      WHERE id = ?
    `).run(name, code, category, description, formula, unit, direction, applicable_roles != null ? JSON.stringify(applicable_roles) : null, req.params.id);

    const updated = await db.prepare('SELECT * FROM kpi_definitions WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    const kpi = await db.prepare('SELECT * FROM kpi_definitions WHERE id = ?').get(req.params.id);
    if (!kpi) return res.status(404).json({ error: 'KPI not found' });

    await db.prepare('UPDATE kpi_definitions SET is_active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
