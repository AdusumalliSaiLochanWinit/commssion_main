import pg from 'pg';
const { Client } = pg;

const NEON_URL = 'postgresql://neondb_owner:npg_oRju3Uw1GtWl@ep-empty-mountain-anu5bjhi-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const TARGET_URL = 'postgresql://choithram:choithram@10.20.53.10:5432/pepsicodubaidev';

async function createMissingTablesAndMigrate() {
  const source = new Client({ connectionString: NEON_URL });
  const target = new Client({ connectionString: TARGET_URL });

  await source.connect();
  console.log('Connected to Neon');
  await target.connect();
  console.log('Connected to target');

  // Disable FK checks
  await target.query('SET session_replication_role = replica;');

  // Create trips table
  await target.query(`
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      trip_number TEXT,
      trip_date TEXT NOT NULL,
      trip_end_date TEXT,
      days_count INTEGER DEFAULT 1,
      period TEXT NOT NULL,
      territory_id TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      distance_km REAL DEFAULT 0,
      stops_count INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT NOW()
    )
  `);
  console.log('trips table ready');

  // Create trip_participants table
  await target.query(`
    CREATE TABLE IF NOT EXISTS trip_participants (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      role_on_trip TEXT DEFAULT 'helper',
      UNIQUE(trip_id, employee_id)
    )
  `);
  console.log('trip_participants table ready');

  // Migrate trips
  const trips = await source.query('SELECT * FROM trips');
  if (trips.rows.length > 0) {
    const cols = Object.keys(trips.rows[0]);
    const ph = cols.map((_, i) => '$' + (i + 1)).join(', ');
    const sql = `INSERT INTO trips (${cols.join(', ')}) VALUES (${ph}) ON CONFLICT DO NOTHING`;
    for (const row of trips.rows) {
      await target.query(sql, cols.map(c => row[c]));
    }
    console.log(`Migrated ${trips.rows.length} rows into trips`);
  } else {
    console.log('trips: 0 rows in source, skipped');
  }

  // Migrate trip_participants
  const participants = await source.query('SELECT * FROM trip_participants');
  if (participants.rows.length > 0) {
    const cols = Object.keys(participants.rows[0]);
    const ph = cols.map((_, i) => '$' + (i + 1)).join(', ');
    const sql = `INSERT INTO trip_participants (${cols.join(', ')}) VALUES (${ph}) ON CONFLICT DO NOTHING`;
    for (const row of participants.rows) {
      await target.query(sql, cols.map(c => row[c]));
    }
    console.log(`Migrated ${participants.rows.length} rows into trip_participants`);
  } else {
    console.log('trip_participants: 0 rows in source, skipped');
  }

  // Re-enable FK checks
  await target.query('SET session_replication_role = DEFAULT;');

  // Final verification - count all tables on target
  const result = await target.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' ORDER BY table_name
  `);
  console.log('\n=== FINAL TABLE COUNT ON TARGET ===');
  console.log('Total tables:', result.rows.length);
  result.rows.forEach(r => console.log(' ', r.table_name));

  await source.end();
  await target.end();
  console.log('\nDone!');
}

createMissingTablesAndMigrate().catch(e => console.error('Error:', e.message));
