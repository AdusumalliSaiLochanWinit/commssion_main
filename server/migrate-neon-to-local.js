import pg from 'pg';
const { Client } = pg;

// --- CONFIGURATION ---
// Replace this with your actual Neon PostgreSQL connection string from Vercel
const SOURCE_DB_URL = process.env.SOURCE_DB_URL || 'postgresql://neondb_owner:npg_oRju3Uw1GtWl@ep-empty-mountain-anu5bjhi-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

// The new internal server you are migrating to
const TARGET_DB_URL = process.env.TARGET_DB_URL || 'postgresql://choithram:choithram@10.20.53.10:5432/pepsicodubaidev';

// Tables ordered by dependency (so foreign keys don't break during insert)
const TABLES_TO_MIGRATE = [
  // Base tables - no dependencies
  'currencies',
  'roles',
  'tags',
  'kpi_definitions',

  // Depend on base tables
  'exchange_rates',       // refs currencies
  'territories',          // self-ref parent_id (handled by FK disable)
  'products',
  'commission_plans',

  // Depend on commission_plans
  'slab_sets',
  'plan_roles',           // refs commission_plans, roles
  'plan_territories',     // refs commission_plans, territories
  'plan_kpis',            // refs commission_plans, kpi_definitions
  'helper_trip_rates',    // refs commission_plans
  'perfect_store_weights',// refs commission_plans
  'simulation_snapshots', // refs commission_plans

  // Depend on slab_sets
  'slab_tiers',

  // Rule engine
  'rule_sets',
  'rules',
  'multiplier_rules',
  'eligibility_rules',
  'penalty_rules',
  'capping_rules',
  'split_rules',

  // Depend on employees
  'employees',            // refs roles, territories
  'customers',            // refs territories
  'entity_tags',          // refs tags + employees/products/customers
  'employee_territory_history', // refs employees, territories

  // Trips
  'trips',                // refs territories
  'trip_participants',    // refs trips, employees

  // Transactions & events
  'transactions',         // refs employees, products, customers
  'split_participants',   // refs split_rules, employees
  'commission_events',    // refs employees, commission_plans

  // Calculation results
  'calculation_runs',     // refs commission_plans
  'kpi_results',          // refs calculation_runs, employees, kpi_definitions
  'employee_payouts',     // refs calculation_runs, employees, commission_plans

  // Audits & logs
  'perfect_store_audits', // refs employees, customers
  'audit_trail',
  'approval_log',
];

async function migrateData() {
  console.log('=== Starting Database Migration ===');
  console.log(`Source: ${SOURCE_DB_URL.split('@')[1] || 'Unknown'}`);
  console.log(`Target: 10.20.53.10`);

  const sourceClient = new Client({ connectionString: SOURCE_DB_URL });
  const targetClient = new Client({ connectionString: TARGET_DB_URL, connectionTimeoutMillis: 5000 });

  try {
    console.log('Connecting to Source (Neon)...');
    await sourceClient.connect();
    console.log('✅ Connected to Source.');

    console.log('Connecting to Target (10.20.53.10)...');
    await targetClient.connect();
    console.log('✅ Connected to Target.');

    // Disable foreign keys temporarily on target during migration
    await targetClient.query('SET session_replication_role = replica;');

    for (const tableName of TABLES_TO_MIGRATE) {
      console.log(`\nMigrating table: ${tableName}...`);
      
      try {
        // Fetch data from source
        const res = await sourceClient.query(`SELECT * FROM ${tableName}`);
        const rows = res.rows;
        
        if (rows.length === 0) {
          console.log(`  Skipped (0 rows found in source)`);
          continue;
        }

        // Generate columns and placeholders
        const columns = Object.keys(rows[0]);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const insertQuery = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

        // Insert into target
        let successCount = 0;
        await targetClient.query('BEGIN');
        for (const row of rows) {
          const values = columns.map(col => row[col]);
          await targetClient.query(insertQuery, values);
          successCount++;
        }
        await targetClient.query('COMMIT');
        
        console.log(`  ✅ Successfully migrated ${successCount} rows into ${tableName}`);
      } catch (err) {
        await targetClient.query('ROLLBACK');
        console.log(`  ❌ Failed to migrate ${tableName}:`, err.message);
      }
    }

    // Re-enable foreign keys
    await targetClient.query('SET session_replication_role = DEFAULT;');
    console.log('\n=== Migration Completed Successfully! ===');

  } catch (error) {
    console.error('\n❌ Migration Failed:', error.message);
  } finally {
    await sourceClient.end();
    await targetClient.end();
  }
}

migrateData();
