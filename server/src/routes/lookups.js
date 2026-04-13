import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// Helper: expand territory IDs to include all descendant territories
async function expandTerritories(db, territoryIds) {
  if (!territoryIds || territoryIds.length === 0) return [];
  const placeholders = territoryIds.map(() => '?').join(',');
  const rows = await db.prepare(`
    WITH RECURSIVE territory_tree AS (
      SELECT id FROM territories WHERE id IN (${placeholders})
      UNION ALL
      SELECT t.id FROM territories t
      JOIN territory_tree tt ON t.parent_id = tt.id
    )
    SELECT DISTINCT id FROM territory_tree
  `).all(...territoryIds);
  return rows.map(r => r.id);
}

// GET /api/lookups/filter-values?field=product_category&territories=terr-1,terr-2
// Returns distinct values for a given filter field
// For customer fields, optionally filters by plan territories
router.get('/filter-values', async (req, res) => {
  try {
    const db = getDb();
    const { field, territories } = req.query;

    // Parse and expand territory filter
    const territoryIds = territories ? territories.split(',').filter(Boolean) : [];
    const expandedTerritories = territoryIds.length > 0 ? await expandTerritories(db, territoryIds) : [];
    const hasTerritoryFilter = expandedTerritories.length > 0;
    const tPlaceholders = expandedTerritories.map(() => '?').join(',');
    const tWhere = hasTerritoryFilter ? ` AND territory_id IN (${tPlaceholders})` : '';

    const queries = {
      product_category: { sql: `SELECT DISTINCT category as value, category as label FROM products WHERE category IS NOT NULL AND category != '' ORDER BY category`, params: [] },
      product_sku: { sql: `SELECT sku as value, name || ' (' || sku || ')' as label FROM products ORDER BY name`, params: [] },
      customer_channel: { sql: `SELECT DISTINCT channel as value, CASE WHEN channel_name IS NOT NULL AND channel_name != '' AND channel_name != '.' THEN channel_name || ' (' || channel || ')' ELSE channel END as label FROM customers WHERE channel IS NOT NULL AND channel != ''${tWhere} ORDER BY channel`, params: hasTerritoryFilter ? expandedTerritories : [] },
      customer_group: { sql: `SELECT DISTINCT customer_group as value, CASE WHEN customer_group_name IS NOT NULL AND customer_group_name != '' THEN customer_group_name || ' (' || customer_group || ')' ELSE customer_group END as label FROM customers WHERE customer_group IS NOT NULL AND customer_group != ''${tWhere} ORDER BY customer_group`, params: hasTerritoryFilter ? expandedTerritories : [] },
      is_strategic: null,
      is_new_launch: null,
    };

    if (!(field in queries)) {
      return res.status(400).json({ error: `Unknown filter field: ${field}` });
    }

    // Boolean fields have fixed options
    if (queries[field] === null) {
      return res.json([
        { value: 1, label: 'Yes' },
        { value: 0, label: 'No' },
      ]);
    }

    const { sql, params } = queries[field];
    const rows = await db.prepare(sql).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/lookups/products?search=bread
router.get('/products', async (req, res) => {
  try {
    const db = getDb();
    const { search, category } = req.query;
    let query = 'SELECT id, name, sku, category FROM products WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (name LIKE ? OR sku LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    query += ' ORDER BY category, name LIMIT 100';
    res.json(await db.prepare(query).all(...params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/lookups/customers?search=lulu&territories=terr-1,terr-2
router.get('/customers', async (req, res) => {
  try {
    const db = getDb();
    const { search, channel, customer_group, territories } = req.query;
    let query = 'SELECT id, name, channel, channel_name, customer_group, customer_group_name, territory_id FROM customers WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND name LIKE ?';
      params.push(`%${search}%`);
    }
    if (channel) {
      query += ' AND channel = ?';
      params.push(channel);
    }
    if (customer_group) {
      query += ' AND customer_group = ?';
      params.push(customer_group);
    }

    // Territory filtering with hierarchy expansion
    const territoryIds = territories ? territories.split(',').filter(Boolean) : [];
    if (territoryIds.length > 0) {
      const expanded = await expandTerritories(db, territoryIds);
      if (expanded.length > 0) {
        query += ` AND territory_id IN (${expanded.map(() => '?').join(',')})`;
        params.push(...expanded);
      }
    }

    query += ' ORDER BY name LIMIT 100';
    res.json(await db.prepare(query).all(...params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
