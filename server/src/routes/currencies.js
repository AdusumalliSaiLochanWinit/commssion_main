import { Router } from 'express';
import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

const router = Router();

// List all currencies
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const currencies = await db.prepare('SELECT * FROM currencies ORDER BY is_base DESC, code').all();
    res.json(currencies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List exchange rates
router.get('/rates', async (req, res) => {
  try {
    const db = getDb();
    const { from_currency, to_currency } = req.query;
    let sql = 'SELECT * FROM exchange_rates WHERE 1=1';
    const args = [];
    if (from_currency) { sql += ' AND from_currency = ?'; args.push(from_currency); }
    if (to_currency) { sql += ' AND to_currency = ?'; args.push(to_currency); }
    sql += ' ORDER BY effective_date DESC';
    const rates = await db.prepare(sql).all(...args);
    res.json(rates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Convert amount between currencies (as-of date)
router.get('/convert', async (req, res) => {
  try {
    const db = getDb();
    const { amount, from, to, date } = req.query;
    if (!amount || !from || !to) return res.status(400).json({ error: 'amount, from, to required' });

    if (from === to) {
      return res.json({ amount: Number(amount), rate: 1 });
    }

    // Direct rate
    let rate = await db.prepare(
      'SELECT rate FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND effective_date <= ? ORDER BY effective_date DESC LIMIT 1'
    ).get(from, to, date || new Date().toISOString().split('T')[0]);

    // Reverse rate (if we have the inverse)
    if (!rate) {
      const inverse = await db.prepare(
        'SELECT rate FROM exchange_rates WHERE from_currency = ? AND to_currency = ? AND effective_date <= ? ORDER BY effective_date DESC LIMIT 1'
      ).get(to, from, date || new Date().toISOString().split('T')[0]);
      if (inverse) rate = { rate: 1 / inverse.rate };
    }

    // Cross rate via AED (base)
    if (!rate) {
      const aedFrom = await db.prepare(
        "SELECT rate FROM exchange_rates WHERE from_currency = 'AED' AND to_currency = ? ORDER BY effective_date DESC LIMIT 1"
      ).get(from);
      const aedTo = await db.prepare(
        "SELECT rate FROM exchange_rates WHERE from_currency = 'AED' AND to_currency = ? ORDER BY effective_date DESC LIMIT 1"
      ).get(to);
      if (aedFrom && aedTo) {
        rate = { rate: aedTo.rate / aedFrom.rate };
      }
    }

    if (!rate) return res.status(404).json({ error: `No rate found for ${from} → ${to}` });

    const converted = Number(amount) * rate.rate;
    res.json({ amount: Math.round(converted * 100) / 100, rate: rate.rate, from, to });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add/update exchange rate
router.post('/rates', async (req, res) => {
  try {
    const db = getDb();
    const { from_currency, to_currency, rate, effective_date } = req.body;
    if (!from_currency || !to_currency || !rate) return res.status(400).json({ error: 'from_currency, to_currency, rate required' });

    await db.prepare(`INSERT OR REPLACE INTO exchange_rates (id, from_currency, to_currency, rate, effective_date)
      VALUES (?, ?, ?, ?, ?)`).run(uuid(), from_currency, to_currency, rate, effective_date || new Date().toISOString().split('T')[0]);
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
