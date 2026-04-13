import { Router } from 'express';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const query = req.query.plan_id
      ? 'SELECT * FROM slab_sets WHERE plan_id = ?'
      : 'SELECT * FROM slab_sets';
    const slabs = req.query.plan_id
      ? await db.prepare(query).all(req.query.plan_id)
      : await db.prepare(query).all();

    for (const slab of slabs) {
      slab.tiers = await db.prepare('SELECT * FROM slab_tiers WHERE slab_set_id = ? ORDER BY tier_order').all(slab.id);
    }

    res.json(slabs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const id = uuid();
    const { name, type, plan_id, kpi_id, tiers } = req.body;

    await db.prepare('INSERT INTO slab_sets (id, name, type, plan_id, kpi_id) VALUES (?, ?, ?, ?, ?)').run(id, name, type, plan_id, kpi_id);

    if (tiers?.length) {
      const stmt = db.prepare('INSERT INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (let i = 0; i < tiers.length; i++) {
        const t = tiers[i];
        await stmt.run(uuid(), id, i + 1, t.min_percent, t.max_percent ?? null, t.rate, t.rate_type || 'percentage');
      }
    }

    const slab = await db.prepare('SELECT * FROM slab_sets WHERE id = ?').get(id);
    slab.tiers = await db.prepare('SELECT * FROM slab_tiers WHERE slab_set_id = ? ORDER BY tier_order').all(id);
    res.status(201).json(slab);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { name, type, tiers } = req.body;

    await db.prepare('UPDATE slab_sets SET name = COALESCE(?, name), type = COALESCE(?, type) WHERE id = ?').run(name, type, req.params.id);

    if (tiers) {
      await db.prepare('DELETE FROM slab_tiers WHERE slab_set_id = ?').run(req.params.id);
      const stmt = db.prepare('INSERT INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (let i = 0; i < tiers.length; i++) {
        const t = tiers[i];
        await stmt.run(uuid(), req.params.id, i + 1, t.min_percent, t.max_percent ?? null, t.rate, t.rate_type || 'percentage');
      }
    }

    const slab = await db.prepare('SELECT * FROM slab_sets WHERE id = ?').get(req.params.id);
    slab.tiers = await db.prepare('SELECT * FROM slab_tiers WHERE slab_set_id = ? ORDER BY tier_order').all(req.params.id);
    res.json(slab);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
