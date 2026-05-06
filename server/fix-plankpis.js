import pg from 'pg';
const { Client } = pg;
const TARGET_URL = 'postgresql://choithram:choithram@10.20.53.10:5432/pepsicodubaidev';

async function run() {
  const target = new Client({ connectionString: TARGET_URL });
  await target.connect();
  
  await target.query(`
    CREATE TABLE IF NOT EXISTS plan_kpis (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      kpi_id TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      target_value REAL,
      UNIQUE(plan_id, kpi_id)
    )
  `);
  console.log('plan_kpis created!');
  
  const tables = await target.query("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'");
  console.log('Total tables now:', tables.rows[0].count);
  await target.end();
}
run();
