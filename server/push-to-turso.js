// Push local commission.db data to Turso using @libsql/client
import { createClient } from '@libsql/client';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_DB_PATH = path.join(__dirname, 'commission.db');

const TURSO_URL = process.env.TURSO_DATABASE_URL || 'libsql://commissioniq-winit.aws-ap-south-1.turso.io';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_TOKEN) {
  console.error('Set TURSO_AUTH_TOKEN environment variable');
  process.exit(1);
}

const localDb = new Database(LOCAL_DB_PATH, { readonly: true });
const remoteClient = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

// Tables in dependency order (parents before children)
const TABLE_ORDER = [
  'roles',
  'territories',
  'products',
  'kpi_definitions',
  'commission_plans',
  'employees',
  'customers',
  'plan_roles',
  'plan_territories',
  'slab_sets',
  'slab_tiers',
  'plan_kpis',
  'rule_sets',
  'rules',
  'eligibility_rules',
  'multiplier_rules',
  'penalty_rules',
  'capping_rules',
  'split_rules',
  'split_participants',
  'transactions',
  'calculation_runs',
  'employee_payouts',
  'kpi_results',
  'approval_log',
  'audit_trail',
  'simulation_snapshots',
];

async function pushToTurso() {
  console.log(`Pushing ${LOCAL_DB_PATH} to ${TURSO_URL}...`);

  // 1. Get table CREATE statements
  const allTables = localDb.prepare(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all();
  const tableMap = {};
  for (const t of allTables) tableMap[t.name] = t.sql;

  // 2. Get all indexes
  const indexes = localDb.prepare(
    "SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"
  ).all();

  // 3. Create schema
  console.log('Creating schema...');
  for (const name of TABLE_ORDER) {
    const sql = tableMap[name];
    if (!sql) { console.log(`  Skip (not found): ${name}`); continue; }
    try {
      await remoteClient.execute(sql);
      console.log(`  Created: ${name}`);
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log(`  Exists: ${name}`);
      } else {
        console.error(`  Error: ${name}: ${err.message}`);
      }
    }
  }

  for (const idx of indexes) {
    try {
      await remoteClient.execute(idx.sql);
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.error(`  Index error: ${err.message.substring(0, 80)}`);
      }
    }
  }

  // 4. Push data in dependency order
  console.log('\nPushing data...');
  for (const tableName of TABLE_ORDER) {
    if (!tableMap[tableName]) continue;

    const count = localDb.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get();
    if (count.c === 0) {
      console.log(`  ${tableName}: 0 rows (skip)`);
      continue;
    }

    const cols = localDb.prepare(`PRAGMA table_info("${tableName}")`).all();
    const colNames = cols.map(c => c.name);
    const placeholders = colNames.map(() => '?').join(',');
    const insertSql = `INSERT OR IGNORE INTO "${tableName}" (${colNames.join(',')}) VALUES (${placeholders})`;

    const rows = localDb.prepare(`SELECT * FROM "${tableName}"`).all();
    const BATCH_SIZE = 80;
    let pushed = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const stmts = chunk.map(row => ({
        sql: insertSql,
        args: colNames.map(col => row[col] ?? null),
      }));

      try {
        await remoteClient.batch(stmts, 'write');
        pushed += chunk.length;
      } catch (err) {
        // Try one by one on batch failure
        for (const stmt of stmts) {
          try {
            await remoteClient.execute(stmt);
            pushed++;
          } catch {
            errors++;
          }
        }
      }

      if (pushed % 5000 === 0 || i + BATCH_SIZE >= rows.length) {
        process.stdout.write(`  ${tableName}: ${pushed}/${rows.length}${errors > 0 ? ` (${errors} errors)` : ''}\r`);
      }
    }
    console.log(`  ${tableName}: ${pushed}/${rows.length} pushed${errors > 0 ? ` (${errors} errors)` : ''}`);
  }

  // 5. Verify
  console.log('\nVerifying...');
  for (const tableName of TABLE_ORDER) {
    if (!tableMap[tableName]) continue;
    const local = localDb.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get();
    if (local.c === 0) continue;
    try {
      const remote = await remoteClient.execute(`SELECT COUNT(*) as c FROM "${tableName}"`);
      const remoteCount = remote.rows[0][0];
      const match = local.c === Number(remoteCount) ? '✓' : '✗';
      console.log(`  ${match} ${tableName}: local=${local.c}, remote=${remoteCount}`);
    } catch (err) {
      console.log(`  ✗ ${tableName}: verify failed: ${err.message}`);
    }
  }

  localDb.close();
  console.log('\nMigration complete!');
}

pushToTurso().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
