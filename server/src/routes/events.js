import { Router } from 'express';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

const router = Router();

const VALID_EVENT_TYPES = [
  'order_booking', 'invoice_generation', 'delivery_confirmation', 'customer_grn',
  'collection_posting', 'asset_installation', 'audit_score', 'campaign_completion',
  'geo_validation', 'image_verification', 'attendance', 'beat_compliance', 'gps_route',
];

// List all events (optionally filter by employee / period / type)
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { employee_id, period, event_type, validated } = req.query;
    let sql = `SELECT ce.*, e.name as employee_name
               FROM commission_events ce
               LEFT JOIN employees e ON ce.employee_id = e.id
               WHERE 1=1`;
    const args = [];
    if (employee_id) { sql += ' AND ce.employee_id = ?'; args.push(employee_id); }
    if (period) { sql += ' AND ce.period = ?'; args.push(period); }
    if (event_type) { sql += ' AND ce.event_type = ?'; args.push(event_type); }
    if (validated !== undefined) { sql += ' AND ce.validated = ?'; args.push(validated === 'true' ? 1 : 0); }
    sql += ' ORDER BY ce.event_date DESC LIMIT 500';
    const events = await db.prepare(sql).all(...args);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get event types and counts
router.get('/summary', async (req, res) => {
  try {
    const db = getDb();
    const { period } = req.query;
    const rows = await db.prepare(`
      SELECT event_type, COUNT(*) as count, SUM(value) as total_value,
             SUM(CASE WHEN validated = 1 THEN 1 ELSE 0 END) as validated_count
      FROM commission_events
      WHERE period = COALESCE(?, period)
      GROUP BY event_type
      ORDER BY count DESC
    `).all(period || null);
    res.json({ types: VALID_EVENT_TYPES, summary: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Post a new event (ERP integration entry point)
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const { event_type, employee_id, reference_id, reference_type, value, metadata, event_date, period, validated } = req.body;

    if (!event_type || !employee_id || !event_date || !period) {
      return res.status(400).json({ error: 'event_type, employee_id, event_date, period are required' });
    }
    if (!VALID_EVENT_TYPES.includes(event_type)) {
      return res.status(400).json({ error: `Invalid event_type. Must be one of: ${VALID_EVENT_TYPES.join(', ')}` });
    }

    const id = uuid();
    await db.prepare(`INSERT INTO commission_events
      (id, event_type, employee_id, reference_id, reference_type, value, metadata, event_date, period, validated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, event_type, employee_id, reference_id || null, reference_type || null,
      value || 0, JSON.stringify(metadata || {}), event_date, period, validated ? 1 : 0
    );

    // Audit trail
    await db.prepare(`INSERT INTO audit_trail (id, entity_type, entity_id, action, changes, performed_by)
      VALUES (?, 'event', ?, 'created', ?, ?)`).run(uuid(), id, JSON.stringify({ event_type, employee_id }), req.body.created_by || 'system');

    res.status(201).json({ id, event_type, employee_id, period });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Validate an event
router.post('/:id/validate', async (req, res) => {
  try {
    const db = getDb();
    const { notes } = req.body;
    await db.prepare('UPDATE commission_events SET validated = 1, validation_notes = ? WHERE id = ?').run(notes || null, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
