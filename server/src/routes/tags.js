import { Router } from 'express';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

const router = Router();

// List all tags (optionally by category)
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { category } = req.query;
    const sql = category
      ? 'SELECT * FROM tags WHERE category = ? ORDER BY name'
      : 'SELECT * FROM tags ORDER BY category, name';
    const tags = category
      ? await db.prepare(sql).all(category)
      : await db.prepare(sql).all();

    // Include usage count
    for (const t of tags) {
      const usage = await db.prepare('SELECT COUNT(*) as c FROM entity_tags WHERE tag_id = ?').get(t.id);
      t.usage_count = usage.c;
    }
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create tag
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const { name, category, color, description } = req.body;
    if (!name || !category) return res.status(400).json({ error: 'name and category are required' });

    const id = `tag-${name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;
    await db.prepare('INSERT INTO tags (id, name, category, color, description) VALUES (?, ?, ?, ?, ?)').run(
      id, name, category, color || '#6366f1', description || null
    );
    res.status(201).json({ id, name, category });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Apply tag to an entity
router.post('/:tagId/apply', async (req, res) => {
  try {
    const db = getDb();
    const { entity_type, entity_id, valid_from, valid_to } = req.body;
    if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_type and entity_id required' });

    await db.prepare(`INSERT OR REPLACE INTO entity_tags (id, tag_id, entity_type, entity_id, valid_from, valid_to)
      VALUES (?, ?, ?, ?, ?, ?)`).run(uuid(), req.params.tagId, entity_type, entity_id, valid_from || null, valid_to || null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove tag from an entity
router.delete('/:tagId/apply', async (req, res) => {
  try {
    const db = getDb();
    const { entity_type, entity_id } = req.query;
    await db.prepare('DELETE FROM entity_tags WHERE tag_id = ? AND entity_type = ? AND entity_id = ?').run(
      req.params.tagId, entity_type, entity_id
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all entities tagged with a tag
router.get('/:tagId/entities', async (req, res) => {
  try {
    const db = getDb();
    const rows = await db.prepare('SELECT * FROM entity_tags WHERE tag_id = ?').all(req.params.tagId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get tags for a specific entity
router.get('/entity/:type/:id', async (req, res) => {
  try {
    const db = getDb();
    const tags = await db.prepare(`
      SELECT t.*, et.valid_from, et.valid_to
      FROM entity_tags et
      JOIN tags t ON et.tag_id = t.id
      WHERE et.entity_type = ? AND et.entity_id = ?
    `).all(req.params.type, req.params.id);
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
