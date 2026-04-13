import { Router } from 'express';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

const router = Router();

/**
 * Helper Trip Commission Module (§6.3)
 *
 * Each completed trip pays all participants based on team size × days:
 *   1 helper × 1 day  → 12 AED (solo single-day)
 *   1 helper × 3 days → 36 AED (solo multi-day)
 *   2 helpers × 2 days → 14 AED each (paired multi-day)
 *   3 helpers × 1 day  → 5 AED each (team single-day)
 *
 * Formula: per_person_earned = rate_per_person × days_count
 * Rates are plan-scoped (or global default if no plan rate set).
 */

// Compute days between two dates (inclusive). If no end date, returns 1.
function computeDays(start, end) {
  if (!end || end === start) return 1;
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s) || isNaN(e)) return 1;
  const diff = Math.round((e - s) / (1000 * 60 * 60 * 24));
  return Math.max(1, diff + 1);
}

// List trips with optional filters
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { employee_id, period, status } = req.query;
    let sql = `
      SELECT t.*,
             (SELECT COUNT(*) FROM trip_participants tp WHERE tp.trip_id = t.id) as team_size
      FROM trips t
      WHERE 1=1
    `;
    const args = [];
    if (period) { sql += ' AND t.period = ?'; args.push(period); }
    if (status) { sql += ' AND t.status = ?'; args.push(status); }
    if (employee_id) {
      sql += ' AND t.id IN (SELECT trip_id FROM trip_participants WHERE employee_id = ?)';
      args.push(employee_id);
    }
    sql += ' ORDER BY t.trip_date DESC LIMIT 500';
    const trips = await db.prepare(sql).all(...args);

    // Attach participants to each trip
    for (const trip of trips) {
      trip.participants = await db.prepare(`
        SELECT tp.*, e.name as employee_name
        FROM trip_participants tp
        LEFT JOIN employees e ON tp.employee_id = e.id
        WHERE tp.trip_id = ?
      `).all(trip.id);
    }

    res.json(trips);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get single trip
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const trip = await db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
    if (!trip) return res.status(404).json({ error: 'Trip not found' });
    trip.participants = await db.prepare(`
      SELECT tp.*, e.name as employee_name, r.name as role_name
      FROM trip_participants tp
      LEFT JOIN employees e ON tp.employee_id = e.id
      LEFT JOIN roles r ON e.role_id = r.id
      WHERE tp.trip_id = ?
    `).all(req.params.id);
    res.json(trip);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a trip (with participants)
router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const { trip_number, trip_date, trip_end_date, period, territory_id, status, distance_km, stops_count, notes, participant_ids } = req.body;
    if (!trip_date || !period) return res.status(400).json({ error: 'trip_date and period required' });
    if (!Array.isArray(participant_ids) || participant_ids.length === 0) {
      return res.status(400).json({ error: 'at least 1 participant required' });
    }

    const days = computeDays(trip_date, trip_end_date);
    const tripId = uuid();
    await db.prepare(`INSERT INTO trips (id, trip_number, trip_date, trip_end_date, days_count, period, territory_id, status, distance_km, stops_count, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      tripId, trip_number || `TRIP-${Date.now()}`, trip_date, trip_end_date || null, days, period, territory_id || null,
      status || 'completed', distance_km || 0, stops_count || 0, notes || null
    );

    for (const empId of participant_ids) {
      await db.prepare('INSERT OR IGNORE INTO trip_participants (id, trip_id, employee_id, role_on_trip) VALUES (?, ?, ?, ?)')
        .run(uuid(), tripId, empId, 'helper');
    }

    // Audit
    await db.prepare(`INSERT INTO audit_trail (id, entity_type, entity_id, action, changes, performed_by)
      VALUES (?, 'trip', ?, 'created', ?, ?)`).run(
      uuid(), tripId, JSON.stringify({ trip_number, team_size: participant_ids.length }), req.body.created_by || 'system'
    );

    res.status(201).json({ id: tripId, trip_number, team_size: participant_ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a trip
router.put('/:id', async (req, res) => {
  try {
    const db = getDb();
    const { trip_number, trip_date, trip_end_date, period, status, distance_km, stops_count, notes, participant_ids } = req.body;

    const existing = await db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Trip not found' });

    const effectiveStart = trip_date || existing.trip_date;
    const effectiveEnd = trip_end_date !== undefined ? trip_end_date : existing.trip_end_date;
    const days = computeDays(effectiveStart, effectiveEnd);

    await db.prepare(`UPDATE trips SET
      trip_number = COALESCE(?, trip_number),
      trip_date = COALESCE(?, trip_date),
      trip_end_date = ?,
      days_count = ?,
      period = COALESCE(?, period),
      status = COALESCE(?, status),
      distance_km = COALESCE(?, distance_km),
      stops_count = COALESCE(?, stops_count),
      notes = COALESCE(?, notes)
      WHERE id = ?`).run(trip_number, trip_date, effectiveEnd || null, days, period, status, distance_km, stops_count, notes, req.params.id);

    if (Array.isArray(participant_ids)) {
      await db.prepare('DELETE FROM trip_participants WHERE trip_id = ?').run(req.params.id);
      for (const empId of participant_ids) {
        await db.prepare('INSERT OR IGNORE INTO trip_participants (id, trip_id, employee_id, role_on_trip) VALUES (?, ?, ?, ?)')
          .run(uuid(), req.params.id, empId, 'helper');
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a trip
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    await db.prepare('DELETE FROM trip_participants WHERE trip_id = ?').run(req.params.id);
    await db.prepare('DELETE FROM trips WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== HELPER TRIP RATES ====================

// Get rate config for a plan (or global default)
router.get('/rates/:planId?', async (req, res) => {
  try {
    const db = getDb();
    const planId = req.params.planId && req.params.planId !== 'default' ? req.params.planId : null;
    let rates = [];
    if (planId) {
      rates = await db.prepare('SELECT * FROM helper_trip_rates WHERE plan_id = ? ORDER BY team_size').all(planId);
    }
    if (rates.length === 0) {
      rates = await db.prepare('SELECT * FROM helper_trip_rates WHERE plan_id IS NULL ORDER BY team_size').all();
    }
    res.json(rates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set rate config for a plan
router.put('/rates/:planId', async (req, res) => {
  try {
    const db = getDb();
    const { rates } = req.body;
    if (!Array.isArray(rates)) return res.status(400).json({ error: 'rates array required' });

    const planId = req.params.planId === 'default' ? null : req.params.planId;

    // Clear existing
    if (planId) {
      await db.prepare('DELETE FROM helper_trip_rates WHERE plan_id = ?').run(planId);
    } else {
      await db.prepare('DELETE FROM helper_trip_rates WHERE plan_id IS NULL').run();
    }

    // Insert new
    for (const r of rates) {
      if (!r.team_size || r.rate_per_person == null) continue;
      await db.prepare('INSERT INTO helper_trip_rates (id, plan_id, team_size, rate_per_person, currency) VALUES (?, ?, ?, ?, ?)')
        .run(uuid(), planId, Number(r.team_size), Number(r.rate_per_person), r.currency || 'AED');
    }

    // Audit
    await db.prepare(`INSERT INTO audit_trail (id, entity_type, entity_id, action, changes, performed_by)
      VALUES (?, 'helper_rates', ?, 'updated', ?, ?)`).run(
      uuid(), planId || 'default', JSON.stringify({ count: rates.length }), req.body.updated_by || 'admin'
    );

    res.json({ success: true, count: rates.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preview commission for an employee in a period (without posting)
router.get('/commission/preview', async (req, res) => {
  try {
    const db = getDb();
    const { employee_id, period, plan_id } = req.query;
    if (!employee_id || !period) return res.status(400).json({ error: 'employee_id and period required' });

    // Load rate tiers (plan-specific or default)
    let tiers = plan_id
      ? await db.prepare('SELECT team_size, rate_per_person FROM helper_trip_rates WHERE plan_id = ?').all(plan_id)
      : [];
    if (tiers.length === 0) {
      tiers = await db.prepare('SELECT team_size, rate_per_person FROM helper_trip_rates WHERE plan_id IS NULL').all();
    }
    // Sort tiers by team_size ascending for lookup
    tiers.sort((a, b) => a.team_size - b.team_size);
    const getRate = (size) => {
      let rate = 0;
      for (const t of tiers) {
        if (t.team_size <= size) rate = t.rate_per_person;
      }
      return rate;
    };

    // Find all trips the employee participated in, with team size
    const trips = await db.prepare(`
      SELECT t.id, t.trip_number, t.trip_date, t.trip_end_date, t.days_count, t.stops_count,
             (SELECT COUNT(*) FROM trip_participants tp2 WHERE tp2.trip_id = t.id) as team_size
      FROM trips t
      JOIN trip_participants tp ON tp.trip_id = t.id
      WHERE tp.employee_id = ? AND t.period = ? AND t.status = 'completed'
      ORDER BY t.trip_date
    `).all(employee_id, period);

    const breakdown = trips.map(t => {
      const days = t.days_count || computeDays(t.trip_date, t.trip_end_date);
      const rate = getRate(t.team_size);
      return {
        ...t,
        days_count: days,
        rate_per_person: rate,
        earned: rate * days,
      };
    });

    const summary = {
      employee_id,
      period,
      total_trips: trips.length,
      total_days: breakdown.reduce((sum, t) => sum + t.days_count, 0),
      solo_trips: trips.filter(t => t.team_size === 1).length,
      paired_trips: trips.filter(t => t.team_size === 2).length,
      team_trips: trips.filter(t => t.team_size >= 3).length,
      total_commission: breakdown.reduce((sum, t) => sum + t.earned, 0),
      currency: 'AED',
      breakdown,
      tiers,
    };

    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
