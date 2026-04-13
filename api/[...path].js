import { initDb } from '../server/src/db/database.js';
import app from '../server/src/app.js';

let initialized = false;

export default async function handler(req, res) {
  try {
    if (!initialized) {
      await initDb();
      initialized = true;
    }

    // Vercel rewrites strip the path — restore it so Express routes match
    if (!req.url.startsWith('/api')) {
      req.url = '/api' + (req.url === '/' ? '' : req.url);
    }

    return app(req, res);
  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ error: err.message });
  }
}
