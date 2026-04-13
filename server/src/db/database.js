import { createClient } from '@libsql/client';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSchema } from './schema.js';
import { v4 as uuid } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let client;

function getClient() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (url && url.startsWith('libsql://')) {
      client = createClient({ url, authToken });
      console.log(`Connected to Turso: ${url}`);
    } else {
      // Local SQLite fallback — use /tmp on Vercel (read-only filesystem)
      const dbPath = process.env.VERCEL
        ? '/tmp/commission.db'
        : path.join(__dirname, '..', '..', 'commission.db');
      client = createClient({ url: `file:${dbPath}` });
      console.log(`Using local SQLite: ${dbPath}`);
    }
  }
  return client;
}

/**
 * Convert a libsql Row to a plain JS object using column names.
 */
function rowToObj(row, columns) {
  if (!row) return undefined;
  const obj = {};
  for (let i = 0; i < columns.length; i++) {
    obj[columns[i]] = row[i];
  }
  return obj;
}

/**
 * Get the database wrapper. Returns an object with prepare/exec/batch methods
 * that mirror better-sqlite3's API but return promises.
 *
 * Usage (same as before, but add `await`):
 *   const db = getDb();
 *   const row = await db.prepare('SELECT * FROM foo WHERE id = ?').get(id);
 *   const rows = await db.prepare('SELECT * FROM foo').all();
 *   await db.prepare('INSERT INTO foo (a) VALUES (?)').run(value);
 */
export function getDb() {
  const c = getClient();

  // libsql rejects undefined args — coerce to null
  const sanitize = (args) => args.map(a => a === undefined ? null : a);

  return {
    prepare(sql) {
      return {
        async get(...args) {
          const result = await c.execute({ sql, args: sanitize(args) });
          return result.rows.length > 0 ? rowToObj(result.rows[0], result.columns) : undefined;
        },
        async all(...args) {
          const result = await c.execute({ sql, args: sanitize(args) });
          return result.rows.map(row => rowToObj(row, result.columns));
        },
        async run(...args) {
          const result = await c.execute({ sql, args: sanitize(args) });
          return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowId };
        },
      };
    },

    /** Execute multiple SQL statements (DDL, etc.) separated by semicolons. */
    async exec(sql) {
      await c.executeMultiple(sql);
    },

    /**
     * Execute multiple statements atomically (like a transaction).
     * @param {Array<{sql: string, args: any[]}>} statements
     */
    async batch(statements) {
      const safe = statements.map(s => ({ sql: s.sql, args: sanitize(s.args || []) }));
      const results = await c.batch(safe, 'write');
      return results;
    },

    /** Raw client access for advanced operations */
    get client() { return c; },
  };
}

export async function initDb() {
  const db = getDb();
  try { await createSchema(db); } catch (e) { console.log('createSchema warning:', e.message); }
  try { await migrateCustomerColumns(db); } catch {}
  try { await migrateEmployeeExternalId(db); } catch {}
  try { await migrateAdvancedFeatures(db); } catch {}
  try { await seedKpisIfEmpty(db); } catch (e) { console.log('seedKpisIfEmpty warning:', e.message); }
  try { await migrateFormulas(db); } catch {}
  try { await seedAdvancedFeatureData(db); } catch (e) { console.log('seedAdvancedFeatureData warning:', e.message); }

  // YOMI sync — only runs locally when better-sqlite3 is available
  try {
    const { syncFromYaumi } = await import('./yaumiSync.js');
    await syncFromYaumi(db);
  } catch (err) {
    console.log('YOMI sync skipped (better-sqlite3 not available or YOMI DB not found)');
  }

  // Seed reference data if tables are empty (fallback when YOMI unavailable)
  try {
    await seedReferenceDataIfEmpty(db);
  } catch (e) {
    console.log('seedReferenceDataIfEmpty warning:', e.message);
  }

  console.log('Database initialized');
}

/**
 * Seed roles, territories, products, customers, employees, and sample plans
 * when YOMI sync is unavailable (e.g. on Vercel).
 */
async function seedReferenceDataIfEmpty(db) {
  // --- ROLES (WINIT SFA spec §3: 10 required sales & execution roles) ---
  // Idempotent upsert — INSERT OR IGNORE so new roles get added even if table has old ones
  {
    const roles = [
      { id: 'role-pre-sales', name: 'Pre-Sales Representative', level: 1, description: 'Books orders for next-day delivery; commission on delivered value', is_field_role: 1 },
      { id: 'role-van-sales', name: 'Van Sales Representative', level: 1, description: 'Sells directly from the van on route (immediate delivery)', is_field_role: 1 },
      { id: 'role-delivery', name: 'Delivery Driver', level: 1, description: 'Delivers orders booked by Pre-Sales; per-drop / on-time commission', is_field_role: 1 },
      { id: 'role-helper', name: 'Helper', level: 1, description: 'Delivery helper / loader / unloader; commission based on per-trip × team-size × days', is_field_role: 1 },
      { id: 'role-merchandiser', name: 'Merchandiser', level: 1, description: 'In-store merchandising, shelf management, planogram compliance', is_field_role: 1 },
      { id: 'role-trade-mkt', name: 'Trade Marketing Executive', level: 2, description: 'Campaign execution, promo compliance, launch activation', is_field_role: 1 },
      { id: 'role-ka-exec', name: 'Key Account Executive', level: 2, description: 'Manages named key accounts (MT chains, HORECA)', is_field_role: 1 },
      { id: 'role-ss', name: 'Sales Supervisor', level: 2, description: 'Supervises field reps across multiple routes', is_field_role: 0 },
      { id: 'role-asm', name: 'Area Sales Manager', level: 3, description: 'Manages sales across an area / depot', is_field_role: 0 },
      { id: 'role-rsm', name: 'Regional Sales Manager', level: 4, description: 'Manages sales across a region (multiple areas)', is_field_role: 0 },
      { id: 'role-nsm', name: 'National Sales Manager', level: 5, description: 'Oversees national sales operations', is_field_role: 0 },
      // Legacy aliases retained for backward compatibility with older plans
      { id: 'role-salesman', name: 'Salesman (legacy)', level: 1, description: 'Legacy alias — use Pre-Sales Representative', is_field_role: 1 },
      { id: 'role-van-driver', name: 'Van Driver (legacy)', level: 1, description: 'Legacy alias — use Van Sales Representative', is_field_role: 1 },
      { id: 'role-route-sup', name: 'Route Supervisor (legacy)', level: 2, description: 'Legacy alias — use Sales Supervisor', is_field_role: 0 },
      { id: 'role-depot-mgr', name: 'Depot Manager (legacy)', level: 3, description: 'Legacy alias — use Area Sales Manager', is_field_role: 0 },
      { id: 'role-ka-mgr', name: 'Key Account Manager (legacy)', level: 3, description: 'Legacy alias — use Key Account Executive', is_field_role: 0 },
      { id: 'role-sales-mgr', name: 'Sales Manager (legacy)', level: 4, description: 'Legacy alias — use Regional Sales Manager', is_field_role: 0 },
      { id: 'role-gm', name: 'General Manager (legacy)', level: 5, description: 'Legacy alias — use National Sales Manager', is_field_role: 0 },
    ];
    await db.batch(roles.map(r => ({
      sql: 'INSERT OR IGNORE INTO roles (id, name, level, description, is_field_role) VALUES (?, ?, ?, ?, ?)',
      args: [r.id, r.name, r.level, r.description, r.is_field_role],
    })));
    console.log(`Seeded ${roles.length} roles`);
  }

  // --- EXTENDED KPI LIBRARY (WINIT SFA spec §8: ~80 KPIs across 9 categories) ---
  // Idempotent: always tries to insert missing KPIs with INSERT OR IGNORE
  await seedExtendedKpiLibrary(db);

  // --- TERRITORIES ---
  const terrCount = await db.prepare('SELECT COUNT(*) as c FROM territories').get();
  if (terrCount.c === 0) {
    const territories = [
      { id: 'terr-uae', name: 'UAE', type: 'national', parent_id: null },
      { id: 'terr-wh-DXB', name: 'DXB P1', type: 'region', parent_id: 'terr-uae' },
      { id: 'terr-wh-AUH', name: 'ABU DHABI', type: 'region', parent_id: 'terr-uae' },
      { id: 'terr-rt-101', name: 'Route 101 - Deira', type: 'area', parent_id: 'terr-wh-DXB' },
      { id: 'terr-rt-102', name: 'Route 102 - Bur Dubai', type: 'area', parent_id: 'terr-wh-DXB' },
      { id: 'terr-rt-103', name: 'Route 103 - Sharjah', type: 'area', parent_id: 'terr-wh-DXB' },
      { id: 'terr-rt-104', name: 'Route 104 - Ajman', type: 'area', parent_id: 'terr-wh-DXB' },
      { id: 'terr-rt-201', name: 'Route 201 - Abu Dhabi City', type: 'area', parent_id: 'terr-wh-AUH' },
      { id: 'terr-rt-202', name: 'Route 202 - Al Ain', type: 'area', parent_id: 'terr-wh-AUH' },
    ];
    await db.batch(territories.map(t => ({
      sql: 'INSERT OR IGNORE INTO territories (id, name, type, parent_id) VALUES (?, ?, ?, ?)',
      args: [t.id, t.name, t.type, t.parent_id],
    })));
    console.log(`Seeded ${territories.length} territories`);
  }

  // --- PRODUCTS ---
  const prodCount = await db.prepare('SELECT COUNT(*) as c FROM products').get();
  if (prodCount.c === 0) {
    const products = [
      { id: 'prod-001', name: 'Arabic Bread White Large', sku: '50-4401', category: 'ARABIC BREAD', subcategory: 'White', unit_price: 3.5, is_strategic: 1, is_new_launch: 0 },
      { id: 'prod-002', name: 'Arabic Bread Brown', sku: '50-4402', category: 'ARABIC BREAD', subcategory: 'Brown', unit_price: 4.0, is_strategic: 1, is_new_launch: 0 },
      { id: 'prod-003', name: 'Sliced Bread White 600g', sku: '50-4410', category: 'SLICED BREAD', subcategory: 'White', unit_price: 5.5, is_strategic: 1, is_new_launch: 0 },
      { id: 'prod-004', name: 'Sliced Bread Whole Wheat', sku: '50-4411', category: 'SLICED BREAD', subcategory: 'Whole Wheat', unit_price: 6.0, is_strategic: 1, is_new_launch: 1 },
      { id: 'prod-005', name: 'Burger Buns 6-Pack', sku: '50-4420', category: 'BUNS', subcategory: 'Burger', unit_price: 7.0, is_strategic: 0, is_new_launch: 0 },
      { id: 'prod-006', name: 'Hot Dog Rolls 6-Pack', sku: '50-4421', category: 'ROLLS', subcategory: 'Hot Dog', unit_price: 6.5, is_strategic: 0, is_new_launch: 0 },
      { id: 'prod-007', name: 'Vanilla Cup Cake 6-Pack', sku: '50-4430', category: 'CUP CAKES', subcategory: 'Vanilla', unit_price: 8.0, is_strategic: 0, is_new_launch: 0 },
      { id: 'prod-008', name: 'Chocolate Pound Cake', sku: '50-4440', category: 'POUND CAKES', subcategory: 'Chocolate', unit_price: 12.0, is_strategic: 0, is_new_launch: 1 },
      { id: 'prod-009', name: 'Chicken Puff', sku: '50-4450', category: 'PUFFS', subcategory: 'Chicken', unit_price: 2.5, is_strategic: 0, is_new_launch: 0 },
      { id: 'prod-010', name: 'Vegetable Samosa 4-Pack', sku: '50-4460', category: 'SAMOSA', subcategory: 'Vegetable', unit_price: 5.0, is_strategic: 0, is_new_launch: 0 },
      { id: 'prod-011', name: 'Fresh Tortilla Wrap 8-Pack', sku: '50-4470', category: 'Fresh Tortilla', subcategory: null, unit_price: 9.0, is_strategic: 0, is_new_launch: 1 },
      { id: 'prod-012', name: 'Sandwich Bread Classic', sku: '50-4480', category: 'SANDWICH BREAD', subcategory: 'Classic', unit_price: 4.5, is_strategic: 0, is_new_launch: 0 },
    ];
    await db.batch(products.map(p => ({
      sql: 'INSERT OR IGNORE INTO products (id, name, sku, category, subcategory, unit_price, is_strategic, is_new_launch, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [p.id, p.name, p.sku, p.category, p.subcategory, p.unit_price, p.is_strategic, p.is_new_launch, '[]'],
    })));
    console.log(`Seeded ${products.length} products`);
  }

  // --- CUSTOMERS ---
  const custCount = await db.prepare('SELECT COUNT(*) as c FROM customers').get();
  if (custCount.c === 0) {
    const customers = [
      { id: 'cust-001', name: 'LULU Hypermarket - Al Barsha', channel: 'KH', channel_name: 'Key Account Hyper Market', customer_group: 'LULU', customer_group_name: 'LULU Group', territory_id: 'terr-rt-101' },
      { id: 'cust-002', name: 'LULU Supermarket - Deira', channel: 'KS', channel_name: 'Key Account Super Market', customer_group: 'LULU', customer_group_name: 'LULU Group', territory_id: 'terr-rt-101' },
      { id: 'cust-003', name: 'Carrefour - Mall of Emirates', channel: 'KH', channel_name: 'Key Account Hyper Market', customer_group: 'DUBKEY', customer_group_name: 'Dubai Key Accounts', territory_id: 'terr-rt-102' },
      { id: 'cust-004', name: 'Al Madina Grocery', channel: 'LG', channel_name: 'Large Groceries', customer_group: 'DUBCRD', customer_group_name: 'Dubai Credit', territory_id: 'terr-rt-102' },
      { id: 'cust-005', name: 'Mini Market - JLT', channel: 'MM', channel_name: 'Mini Market', customer_group: 'DUBCRD', customer_group_name: 'Dubai Credit', territory_id: 'terr-rt-103' },
      { id: 'cust-006', name: 'Quick Stop - Sharjah', channel: 'SG', channel_name: 'Small Groceries', customer_group: 'DUBCRD', customer_group_name: 'Dubai Credit', territory_id: 'terr-rt-103' },
      { id: 'cust-007', name: 'EMARAT Station - Sheikh Zayed', channel: 'PS', channel_name: 'Petrol Station', customer_group: 'EMARAT', customer_group_name: 'EMARAT Group', territory_id: 'terr-rt-104' },
      { id: 'cust-008', name: 'Burger King - Abu Dhabi', channel: 'HO', channel_name: 'Fast Foods', customer_group: 'DUBKEY', customer_group_name: 'Dubai Key Accounts', territory_id: 'terr-rt-201' },
      { id: 'cust-009', name: 'Spinneys - Al Ain', channel: 'KS', channel_name: 'Key Account Super Market', customer_group: 'DUBKEY', customer_group_name: 'Dubai Key Accounts', territory_id: 'terr-rt-202' },
      { id: 'cust-010', name: 'Amazon.ae Fresh', channel: 'EC', channel_name: 'E-Commerce', customer_group: 'AMAZONAE', customer_group_name: 'Amazon UAE', territory_id: 'terr-rt-101' },
    ];
    await db.batch(customers.map(c => ({
      sql: 'INSERT OR IGNORE INTO customers (id, name, channel, channel_name, customer_group, customer_group_name, territory_id, credit_limit, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [c.id, c.name, c.channel, c.channel_name, c.customer_group, c.customer_group_name, c.territory_id, 50000, '[]'],
    })));
    console.log(`Seeded ${customers.length} customers`);
  }

  // --- EMPLOYEES ---
  const empCount = await db.prepare('SELECT COUNT(*) as c FROM employees').get();
  if (empCount.c === 0) {
    // Insert employees in dependency order (managers first, then reports)
    const employees = [
      { id: 'emp-011', name: 'Hassan Al Rashid', email: 'hassan.rashid@company.com', role_id: 'role-sales-mgr', territory_id: 'terr-uae', reports_to: null, base_salary: 18000, hire_date: '2018-06-01' },
      { id: 'emp-009', name: 'Omar Farouk', email: 'omar.farouk@company.com', role_id: 'role-depot-mgr', territory_id: 'terr-wh-DXB', reports_to: 'emp-011', base_salary: 12000, hire_date: '2019-01-01' },
      { id: 'emp-010', name: 'Nadia Khalil', email: 'nadia.khalil@company.com', role_id: 'role-ka-mgr', territory_id: 'terr-uae', reports_to: 'emp-011', base_salary: 10000, hire_date: '2021-03-01' },
      { id: 'emp-007', name: 'Yusuf Ibrahim', email: 'yusuf.ibrahim@company.com', role_id: 'role-route-sup', territory_id: 'terr-wh-DXB', reports_to: 'emp-009', base_salary: 8000, hire_date: '2020-04-01' },
      { id: 'emp-008', name: 'Layla Mahmoud', email: 'layla.mahmoud@company.com', role_id: 'role-route-sup', territory_id: 'terr-wh-AUH', reports_to: 'emp-009', base_salary: 8000, hire_date: '2020-09-15' },
      { id: 'emp-001', name: 'Ahmed Hassan', email: 'ahmed.hassan@company.com', role_id: 'role-salesman', territory_id: 'terr-rt-101', reports_to: 'emp-007', base_salary: 5000, hire_date: '2022-03-15' },
      { id: 'emp-002', name: 'Mohammed Ali', email: 'mohammed.ali@company.com', role_id: 'role-salesman', territory_id: 'terr-rt-102', reports_to: 'emp-007', base_salary: 5000, hire_date: '2021-08-01' },
      { id: 'emp-003', name: 'Khalid Omar', email: 'khalid.omar@company.com', role_id: 'role-van-driver', territory_id: 'terr-rt-103', reports_to: 'emp-007', base_salary: 4500, hire_date: '2023-01-10' },
      { id: 'emp-004', name: 'Fatima Zahra', email: 'fatima.zahra@company.com', role_id: 'role-salesman', territory_id: 'terr-rt-104', reports_to: 'emp-007', base_salary: 5000, hire_date: '2022-06-20' },
      { id: 'emp-005', name: 'Saeed Al Maktoum', email: 'saeed.maktoum@company.com', role_id: 'role-salesman', territory_id: 'terr-rt-201', reports_to: 'emp-008', base_salary: 5200, hire_date: '2021-11-01' },
      { id: 'emp-006', name: 'Rashid Noor', email: 'rashid.noor@company.com', role_id: 'role-van-driver', territory_id: 'terr-rt-202', reports_to: 'emp-008', base_salary: 4500, hire_date: '2023-05-15' },
    ];
    // Insert one by one to respect FK order
    for (const e of employees) {
      await db.prepare('INSERT OR IGNORE INTO employees (id, name, email, role_id, territory_id, reports_to, base_salary, hire_date, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        e.id, e.name, e.email, e.role_id, e.territory_id, e.reports_to, e.base_salary, e.hire_date, 1
      );
    }
    console.log(`Seeded ${employees.length} employees`);
  }

  // --- SAMPLE TRANSACTIONS ---
  // Always ensure transactions exist for: 2026-01 (historical) + current month + previous month
  // This way calculations work regardless of which period the user picks.
  {
    const salesEmployees = ['emp-001', 'emp-002', 'emp-003', 'emp-004', 'emp-005', 'emp-006'];
    const productIds = ['prod-001','prod-002','prod-003','prod-004','prod-005','prod-006','prod-007','prod-008','prod-009','prod-010','prod-011','prod-012'];
    const priceMap = [3.5, 4.0, 5.5, 6.0, 7.0, 6.5, 8.0, 12.0, 2.5, 5.0, 9.0, 4.5];
    const custMap = {
      'emp-001': ['cust-001','cust-002','cust-010'],
      'emp-002': ['cust-003','cust-004'],
      'emp-003': ['cust-005','cust-006'],
      'emp-004': ['cust-007'],
      'emp-005': ['cust-008'],
      'emp-006': ['cust-009'],
    };
    const terrMap = {
      'emp-001': 'terr-rt-101', 'emp-002': 'terr-rt-102', 'emp-003': 'terr-rt-103',
      'emp-004': 'terr-rt-104', 'emp-005': 'terr-rt-201', 'emp-006': 'terr-rt-202',
    };

    const seedPeriod = async (period) => {
      const existing = await db.prepare('SELECT COUNT(*) as c FROM transactions WHERE period = ?').get(period);
      if (existing.c > 0) return 0;

      // Parse YYYY-MM to get days in month
      const [year, month] = period.split('-').map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();
      const seedDays = Math.min(25, daysInMonth);

      const transactions = [];
      for (const empId of salesEmployees) {
        const custs = custMap[empId];
        for (let day = 1; day <= seedDays; day++) {
          const dateStr = `${period}-${String(day).padStart(2, '0')}`;
          for (const custId of custs) {
            const numProducts = 2 + Math.floor(Math.abs(Math.sin(day * 7 + custs.indexOf(custId))) * 4);
            for (let p = 0; p < numProducts; p++) {
              const prodIdx = (day + p + custs.indexOf(custId)) % productIds.length;
              const qty = 10 + Math.floor(Math.abs(Math.sin(day * 3 + p * 5)) * 90);
              const price = priceMap[prodIdx];
              transactions.push({
                id: uuid(), employee_id: empId, customer_id: custId, product_id: productIds[prodIdx],
                transaction_type: 'sale', quantity: qty, amount: +(qty * price).toFixed(2),
                transaction_date: dateStr, period, territory_id: terrMap[empId],
              });
            }
          }
        }
        // Add collections (~85% of sales)
        const empSales = transactions.filter(t => t.employee_id === empId && t.transaction_type === 'sale' && t.period === period);
        const totalSales = empSales.reduce((s, t) => s + t.amount, 0);
        const collDay = String(Math.min(28, seedDays)).padStart(2, '0');
        transactions.push({
          id: uuid(), employee_id: empId, customer_id: custMap[empId][0], product_id: 'prod-001',
          transaction_type: 'collection', quantity: 0, amount: +(totalSales * 0.85).toFixed(2),
          transaction_date: `${period}-${collDay}`, period, territory_id: terrMap[empId],
        });
        // Add some returns (~3%)
        const retDay = String(Math.min(20, seedDays)).padStart(2, '0');
        transactions.push({
          id: uuid(), employee_id: empId, customer_id: custMap[empId][0], product_id: 'prod-001',
          transaction_type: 'return', quantity: 5, amount: +(totalSales * 0.03).toFixed(2),
          transaction_date: `${period}-${retDay}`, period, territory_id: terrMap[empId],
        });
      }

      // Batch insert in chunks of 80
      for (let i = 0; i < transactions.length; i += 80) {
        const chunk = transactions.slice(i, i + 80);
        await db.batch(chunk.map(t => ({
          sql: 'INSERT OR IGNORE INTO transactions (id, employee_id, customer_id, product_id, transaction_type, quantity, amount, transaction_date, period, territory_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          args: [t.id, t.employee_id, t.customer_id, t.product_id, t.transaction_type, t.quantity, t.amount, t.transaction_date, t.period, t.territory_id],
        })));
      }
      return transactions.length;
    };

    // Seed January 2026 (baseline historical data)
    const n1 = await seedPeriod('2026-01');
    if (n1 > 0) console.log(`Seeded ${n1} transactions for 2026-01`);

    // Seed the current month and previous month so calc works out-of-the-box
    const now = new Date();
    const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevPeriod = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;

    if (currentPeriod !== '2026-01') {
      const n2 = await seedPeriod(currentPeriod);
      if (n2 > 0) console.log(`Seeded ${n2} transactions for current period ${currentPeriod}`);
    }
    if (prevPeriod !== '2026-01' && prevPeriod !== currentPeriod) {
      const n3 = await seedPeriod(prevPeriod);
      if (n3 > 0) console.log(`Seeded ${n3} transactions for previous period ${prevPeriod}`);
    }
  }

  // --- SAMPLE COMMISSION PLANS ---
  const samplePlan = await db.prepare("SELECT id FROM commission_plans WHERE id = 'plan-01'").get();
  if (!samplePlan) {
    await db.batch([
      { sql: "INSERT OR IGNORE INTO commission_plans (id, name, description, status, plan_type, effective_from, effective_to, base_payout) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: ['plan-01', 'Salesman Monthly Incentive', 'Monthly commission plan for route salesmen based on revenue, distribution, and collection KPIs', 'active', 'monthly', '2026-01-01', '2026-12-31', 2000] },
      { sql: "INSERT OR IGNORE INTO commission_plans (id, name, description, status, plan_type, effective_from, effective_to, base_payout) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: ['plan-02', 'Supervisor Quarterly Bonus', 'Quarterly bonus plan for route supervisors and depot managers based on team performance', 'active', 'quarterly', '2026-01-01', '2026-12-31', 5000] },
    ]);

    // Plan Roles
    await db.batch([
      { sql: 'INSERT OR IGNORE INTO plan_roles (id, plan_id, role_id) VALUES (?, ?, ?)', args: [uuid(), 'plan-01', 'role-salesman'] },
      { sql: 'INSERT OR IGNORE INTO plan_roles (id, plan_id, role_id) VALUES (?, ?, ?)', args: [uuid(), 'plan-01', 'role-van-driver'] },
      { sql: 'INSERT OR IGNORE INTO plan_roles (id, plan_id, role_id) VALUES (?, ?, ?)', args: [uuid(), 'plan-01', 'role-ka-mgr'] },
      { sql: 'INSERT OR IGNORE INTO plan_roles (id, plan_id, role_id) VALUES (?, ?, ?)', args: [uuid(), 'plan-02', 'role-route-sup'] },
      { sql: 'INSERT OR IGNORE INTO plan_roles (id, plan_id, role_id) VALUES (?, ?, ?)', args: [uuid(), 'plan-02', 'role-depot-mgr'] },
    ]);

    // Plan Territories
    await db.batch([
      { sql: 'INSERT OR IGNORE INTO plan_territories (id, plan_id, territory_id) VALUES (?, ?, ?)', args: [uuid(), 'plan-01', 'terr-uae'] },
      { sql: 'INSERT OR IGNORE INTO plan_territories (id, plan_id, territory_id) VALUES (?, ?, ?)', args: [uuid(), 'plan-01', 'terr-rt-101'] },
      { sql: 'INSERT OR IGNORE INTO plan_territories (id, plan_id, territory_id) VALUES (?, ?, ?)', args: [uuid(), 'plan-01', 'terr-rt-102'] },
      { sql: 'INSERT OR IGNORE INTO plan_territories (id, plan_id, territory_id) VALUES (?, ?, ?)', args: [uuid(), 'plan-01', 'terr-rt-103'] },
      { sql: 'INSERT OR IGNORE INTO plan_territories (id, plan_id, territory_id) VALUES (?, ?, ?)', args: [uuid(), 'plan-01', 'terr-rt-104'] },
      { sql: 'INSERT OR IGNORE INTO plan_territories (id, plan_id, territory_id) VALUES (?, ?, ?)', args: [uuid(), 'plan-01', 'terr-rt-201'] },
      { sql: 'INSERT OR IGNORE INTO plan_territories (id, plan_id, territory_id) VALUES (?, ?, ?)', args: [uuid(), 'plan-01', 'terr-rt-202'] },
      { sql: 'INSERT OR IGNORE INTO plan_territories (id, plan_id, territory_id) VALUES (?, ?, ?)', args: [uuid(), 'plan-02', 'terr-wh-DXB'] },
      { sql: 'INSERT OR IGNORE INTO plan_territories (id, plan_id, territory_id) VALUES (?, ?, ?)', args: [uuid(), 'plan-02', 'terr-wh-AUH'] },
    ]);

    // Slab Sets + Tiers
    await db.batch([
      { sql: 'INSERT OR IGNORE INTO slab_sets (id, name, type, plan_id, kpi_id) VALUES (?, ?, ?, ?, ?)', args: ['slab-01', 'Revenue Step Slab', 'step', 'plan-01', 'kpi-01'] },
      { sql: 'INSERT OR IGNORE INTO slab_sets (id, name, type, plan_id, kpi_id) VALUES (?, ?, ?, ?, ?)', args: ['slab-02', 'Units Progressive Slab', 'progressive', 'plan-01', 'kpi-03'] },
      { sql: 'INSERT OR IGNORE INTO slab_sets (id, name, type, plan_id, kpi_id) VALUES (?, ?, ?, ?, ?)', args: ['slab-03', 'Collection Accelerator', 'accelerator', 'plan-01', 'kpi-06'] },
      { sql: 'INSERT OR IGNORE INTO slab_sets (id, name, type, plan_id, kpi_id) VALUES (?, ?, ?, ?, ?)', args: ['slab-04', 'Team Revenue Slab', 'step', 'plan-02', 'kpi-11'] },
    ]);
    await db.batch([
      { sql: 'INSERT OR IGNORE INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type) VALUES (?,?,?,?,?,?,?)', args: [uuid(), 'slab-01', 1, 0, 70, 0, 'percentage'] },
      { sql: 'INSERT OR IGNORE INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type) VALUES (?,?,?,?,?,?,?)', args: [uuid(), 'slab-01', 2, 70, 85, 3, 'percentage'] },
      { sql: 'INSERT OR IGNORE INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type) VALUES (?,?,?,?,?,?,?)', args: [uuid(), 'slab-01', 3, 85, 100, 5, 'percentage'] },
      { sql: 'INSERT OR IGNORE INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type) VALUES (?,?,?,?,?,?,?)', args: [uuid(), 'slab-01', 4, 100, 120, 8, 'percentage'] },
      { sql: 'INSERT OR IGNORE INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type) VALUES (?,?,?,?,?,?,?)', args: [uuid(), 'slab-01', 5, 120, null, 12, 'percentage'] },
      { sql: 'INSERT OR IGNORE INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type) VALUES (?,?,?,?,?,?,?)', args: [uuid(), 'slab-02', 1, 0, 80, 2, 'per_unit'] },
      { sql: 'INSERT OR IGNORE INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type) VALUES (?,?,?,?,?,?,?)', args: [uuid(), 'slab-02', 2, 80, 100, 4, 'per_unit'] },
      { sql: 'INSERT OR IGNORE INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type) VALUES (?,?,?,?,?,?,?)', args: [uuid(), 'slab-02', 3, 100, 130, 7, 'per_unit'] },
      { sql: 'INSERT OR IGNORE INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type) VALUES (?,?,?,?,?,?,?)', args: [uuid(), 'slab-02', 4, 130, null, 10, 'per_unit'] },
      { sql: 'INSERT OR IGNORE INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type) VALUES (?,?,?,?,?,?,?)', args: [uuid(), 'slab-03', 1, 0, 100, 5, 'percentage'] },
      { sql: 'INSERT OR IGNORE INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type) VALUES (?,?,?,?,?,?,?)', args: [uuid(), 'slab-03', 2, 100, null, 10, 'percentage'] },
      { sql: 'INSERT OR IGNORE INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type) VALUES (?,?,?,?,?,?,?)', args: [uuid(), 'slab-04', 1, 0, 80, 0, 'percentage'] },
      { sql: 'INSERT OR IGNORE INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type) VALUES (?,?,?,?,?,?,?)', args: [uuid(), 'slab-04', 2, 80, 100, 4, 'percentage'] },
      { sql: 'INSERT OR IGNORE INTO slab_tiers (id, slab_set_id, tier_order, min_percent, max_percent, rate, rate_type) VALUES (?,?,?,?,?,?,?)', args: [uuid(), 'slab-04', 3, 100, null, 7, 'percentage'] },
    ]);

    // Plan KPIs
    await db.batch([
      { sql: 'INSERT OR IGNORE INTO plan_kpis (id, plan_id, kpi_id, weight, target_value, slab_set_id) VALUES (?,?,?,?,?,?)', args: [uuid(), 'plan-01', 'kpi-01', 40, 50000, 'slab-01'] },
      { sql: 'INSERT OR IGNORE INTO plan_kpis (id, plan_id, kpi_id, weight, target_value, slab_set_id) VALUES (?,?,?,?,?,?)', args: [uuid(), 'plan-01', 'kpi-03', 20, 5000, 'slab-02'] },
      { sql: 'INSERT OR IGNORE INTO plan_kpis (id, plan_id, kpi_id, weight, target_value, slab_set_id) VALUES (?,?,?,?,?,?)', args: [uuid(), 'plan-01', 'kpi-06', 20, 85, 'slab-03'] },
      { sql: 'INSERT OR IGNORE INTO plan_kpis (id, plan_id, kpi_id, weight, target_value, slab_set_id) VALUES (?,?,?,?,?,?)', args: [uuid(), 'plan-01', 'kpi-04', 10, 50, null] },
      { sql: 'INSERT OR IGNORE INTO plan_kpis (id, plan_id, kpi_id, weight, target_value, slab_set_id) VALUES (?,?,?,?,?,?)', args: [uuid(), 'plan-01', 'kpi-07', 10, 5, null] },
      { sql: 'INSERT OR IGNORE INTO plan_kpis (id, plan_id, kpi_id, weight, target_value, slab_set_id) VALUES (?,?,?,?,?,?)', args: [uuid(), 'plan-02', 'kpi-11', 50, 300000, 'slab-04'] },
      { sql: 'INSERT OR IGNORE INTO plan_kpis (id, plan_id, kpi_id, weight, target_value, slab_set_id) VALUES (?,?,?,?,?,?)', args: [uuid(), 'plan-02', 'kpi-12', 30, 90, null] },
      { sql: 'INSERT OR IGNORE INTO plan_kpis (id, plan_id, kpi_id, weight, target_value, slab_set_id) VALUES (?,?,?,?,?,?)', args: [uuid(), 'plan-02', 'kpi-14', 20, 95, null] },
    ]);

    // Rule Sets
    await db.batch([
      { sql: 'INSERT OR IGNORE INTO rule_sets (id, plan_id, name, description) VALUES (?,?,?,?)', args: ['rs-01', 'plan-01', 'Bakery Product Rules', 'Include all bakery product categories'] },
      { sql: 'INSERT OR IGNORE INTO rule_sets (id, plan_id, name, description) VALUES (?,?,?,?)', args: ['rs-02', 'plan-01', 'Customer Channel Rules', 'Customer channel filtering'] },
    ]);
    await db.batch([
      { sql: 'INSERT OR IGNORE INTO rules (id, rule_set_id, dimension, rule_type, match_type, match_values, priority) VALUES (?,?,?,?,?,?,?)',
        args: [uuid(), 'rs-01', 'product_category', 'include', 'category', '["ARABIC BREAD","SLICED BREAD","BUNS","ROLLS","CUP CAKES","POUND CAKES","PUFFS","SAMOSA","Fresh Tortilla","SANDWICH BREAD"]', 1] },
      { sql: 'INSERT OR IGNORE INTO rules (id, rule_set_id, dimension, rule_type, match_type, match_values, priority) VALUES (?,?,?,?,?,?,?)',
        args: [uuid(), 'rs-02', 'customer_channel', 'include', 'category', '["KH","KS","LG","MG","SG","HO","EC","MM","PH","PS"]', 1] },
    ]);

    // Eligibility, Multipliers, Penalties, Caps
    await db.batch([
      { sql: 'INSERT OR IGNORE INTO eligibility_rules (id, plan_id, metric, operator, threshold, action, reduction_percent) VALUES (?,?,?,?,?,?,?)', args: [uuid(), 'plan-01', 'min_sales', '>=', 10000, 'zero_payout', 0] },
      { sql: 'INSERT OR IGNORE INTO eligibility_rules (id, plan_id, metric, operator, threshold, action, reduction_percent) VALUES (?,?,?,?,?,?,?)', args: [uuid(), 'plan-01', 'max_return_percent', '<=', 10, 'warning_only', 0] },
    ]);
    await db.batch([
      { sql: 'INSERT OR IGNORE INTO multiplier_rules (id, plan_id, name, type, condition_metric, condition_operator, condition_value, multiplier_value, stacking_mode) VALUES (?,?,?,?,?,?,?,?,?)',
        args: [uuid(), 'plan-01', 'Revenue Growth Bonus', 'growth', 'revenue_growth_percent', '>=', 15, 1.15, 'multiplicative'] },
      { sql: 'INSERT OR IGNORE INTO multiplier_rules (id, plan_id, name, type, condition_metric, condition_operator, condition_value, multiplier_value, stacking_mode) VALUES (?,?,?,?,?,?,?,?,?)',
        args: [uuid(), 'plan-01', 'Strategic SKU Push', 'strategic_sku', 'strategic_sku_percent', '>=', 30, 1.10, 'multiplicative'] },
    ]);
    await db.batch([
      { sql: 'INSERT OR IGNORE INTO penalty_rules (id, plan_id, name, trigger_metric, trigger_operator, trigger_value, penalty_type, penalty_value) VALUES (?,?,?,?,?,?,?,?)',
        args: [uuid(), 'plan-01', 'High Returns Penalty', 'return_percent', '>', 8, 'percentage', 15] },
    ]);
    await db.batch([
      { sql: 'INSERT OR IGNORE INTO capping_rules (id, plan_id, cap_type, cap_value) VALUES (?,?,?,?)', args: [uuid(), 'plan-01', 'max_per_plan', 10000] },
      { sql: 'INSERT OR IGNORE INTO capping_rules (id, plan_id, cap_type, cap_value) VALUES (?,?,?,?)', args: [uuid(), 'plan-01', 'percent_of_salary', 150] },
    ]);

    console.log('Seeded 2 commission plans with full configuration');
  }
}

/**
 * Idempotent: seed KPI definitions if table is empty.
 */
async function seedKpisIfEmpty(db) {
  try {
    const count = await db.prepare('SELECT COUNT(*) as c FROM kpi_definitions').get();
    if (count.c > 0) return;

    const kpis = [
      { id: 'kpi-01', name: 'Total Revenue', code: 'TOTAL_REVENUE', category: 'Revenue', description: 'Total sales revenue in the period',
        formula: JSON.stringify({ type: 'simple', aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [] }),
        unit: 'currency', direction: 'higher_is_better', applicable_roles: '["role-salesman","role-van-driver","role-ka-mgr"]', is_active: 1 },
      { id: 'kpi-02', name: 'Revenue Growth %', code: 'REVENUE_GROWTH', category: 'Revenue', description: 'Revenue growth vs same period last year',
        formula: JSON.stringify({ type: 'growth', baseMetric: { aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [] }, compareWith: 'previous_year' }),
        unit: 'percentage', direction: 'higher_is_better', applicable_roles: '["role-salesman","role-depot-mgr","role-sales-mgr"]', is_active: 1 },
      { id: 'kpi-03', name: 'Units Sold', code: 'UNITS_SOLD', category: 'Volume', description: 'Total units sold in the period',
        formula: JSON.stringify({ type: 'simple', aggregation: 'SUM', field: 'quantity', transactionType: 'sale', filters: [] }),
        unit: 'number', direction: 'higher_is_better', applicable_roles: '["role-salesman","role-van-driver"]', is_active: 1 },
      { id: 'kpi-04', name: 'Outlet Coverage', code: 'OUTLET_COVERAGE', category: 'Distribution', description: 'Number of unique outlets with sales',
        formula: JSON.stringify({ type: 'simple', aggregation: 'COUNT_DISTINCT', field: 'customer_id', transactionType: 'sale', filters: [] }),
        unit: 'number', direction: 'higher_is_better', applicable_roles: '["role-salesman","role-van-driver"]', is_active: 1 },
      { id: 'kpi-05', name: 'Lines Per Call', code: 'LINES_PER_CALL', category: 'Distribution', description: 'Average product lines sold per customer visit',
        formula: JSON.stringify({ type: 'ratio', numerator: { aggregation: 'COUNT_DISTINCT', field: 'product_id', transactionType: 'sale', filters: [] }, denominator: { aggregation: 'COUNT_DISTINCT', field: 'customer_id', transactionType: 'sale', filters: [] }, multiplyBy: 1 }),
        unit: 'number', direction: 'higher_is_better', applicable_roles: '["role-salesman","role-van-driver"]', is_active: 1 },
      { id: 'kpi-06', name: 'Collection %', code: 'COLLECTION_PERCENT', category: 'Collection', description: 'Collection amount as % of sales',
        formula: JSON.stringify({ type: 'ratio', numerator: { aggregation: 'SUM', field: 'amount', transactionType: 'collection', filters: [] }, denominator: { aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [] }, multiplyBy: 100 }),
        unit: 'percentage', direction: 'higher_is_better', applicable_roles: '["role-salesman","role-van-driver","role-ka-mgr"]', is_active: 1 },
      { id: 'kpi-07', name: 'Return %', code: 'RETURN_PERCENT', category: 'Returns', description: 'Return amount as % of sales',
        formula: JSON.stringify({ type: 'ratio', numerator: { aggregation: 'SUM', field: 'amount', transactionType: 'return', filters: [] }, denominator: { aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [] }, multiplyBy: 100 }),
        unit: 'percentage', direction: 'lower_is_better', applicable_roles: '["role-salesman","role-van-driver","role-ka-mgr"]', is_active: 1 },
      { id: 'kpi-08', name: 'Strategic SKU Revenue', code: 'STRATEGIC_SKU_REV', category: 'Product Mix', description: 'Revenue from strategic SKUs',
        formula: JSON.stringify({ type: 'simple', aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [{ field: 'is_strategic', operator: '=', value: 1 }] }),
        unit: 'currency', direction: 'higher_is_better', applicable_roles: '["role-salesman","role-ka-mgr"]', is_active: 1 },
      { id: 'kpi-09', name: 'New Launch Sales', code: 'NEW_LAUNCH_SALES', category: 'Product Mix', description: 'Revenue from new product launches',
        formula: JSON.stringify({ type: 'simple', aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [{ field: 'is_new_launch', operator: '=', value: 1 }] }),
        unit: 'currency', direction: 'higher_is_better', applicable_roles: '["role-salesman","role-van-driver"]', is_active: 1 },
      { id: 'kpi-10', name: 'New Customer Acquisition', code: 'NEW_CUSTOMERS', category: 'Customer', description: 'Number of new customers added',
        formula: JSON.stringify({ type: 'simple', aggregation: 'COUNT_DISTINCT', field: 'customer_id', transactionType: 'sale', filters: [] }),
        unit: 'number', direction: 'higher_is_better', applicable_roles: '["role-salesman","role-van-driver"]', is_active: 1 },
      { id: 'kpi-11', name: 'Team Revenue', code: 'TEAM_REVENUE', category: 'Team', description: 'Total revenue of direct reports',
        formula: JSON.stringify({ type: 'team', baseMetric: { aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [] }, teamAggregation: 'SUM' }),
        unit: 'currency', direction: 'higher_is_better', applicable_roles: '["role-route-sup","role-depot-mgr","role-sales-mgr","role-gm"]', is_active: 1 },
      { id: 'kpi-12', name: 'Team Target Achievement', code: 'TEAM_TARGET_ACH', category: 'Team', description: 'Average target achievement % of team',
        formula: JSON.stringify({ type: 'static', defaultValue: 90, source: 'external' }),
        unit: 'percentage', direction: 'higher_is_better', applicable_roles: '["role-route-sup","role-depot-mgr","role-sales-mgr"]', is_active: 1 },
      { id: 'kpi-13', name: 'Revenue Per Outlet', code: 'REV_PER_OUTLET', category: 'Efficiency', description: 'Average revenue per active outlet',
        formula: JSON.stringify({ type: 'ratio', numerator: { aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [] }, denominator: { aggregation: 'COUNT_DISTINCT', field: 'customer_id', transactionType: 'sale', filters: [] }, multiplyBy: 1 }),
        unit: 'currency', direction: 'higher_is_better', applicable_roles: '["role-salesman","role-van-driver"]', is_active: 1 },
      { id: 'kpi-14', name: 'On-Time Delivery %', code: 'OTD_PERCENT', category: 'Compliance', description: 'Orders delivered on scheduled date',
        formula: JSON.stringify({ type: 'static', defaultValue: 92, source: 'external' }),
        unit: 'percentage', direction: 'higher_is_better', applicable_roles: '["role-van-driver"]', is_active: 1 },
      { id: 'kpi-15', name: 'Gross Margin', code: 'GROSS_MARGIN', category: 'Profitability', description: 'Gross profit margin percentage',
        formula: JSON.stringify({ type: 'static', defaultValue: 28, source: 'external' }),
        unit: 'percentage', direction: 'higher_is_better', applicable_roles: '["role-depot-mgr","role-sales-mgr","role-gm","role-ka-mgr"]', is_active: 1 },
    ];

    const cols = Object.keys(kpis[0]);
    const placeholders = cols.map(() => '?').join(',');
    const stmts = kpis.map(kpi => ({
      sql: `INSERT OR IGNORE INTO kpi_definitions (${cols.join(',')}) VALUES (${placeholders})`,
      args: cols.map(c => kpi[c]),
    }));
    await db.batch(stmts);
    console.log(`Seeded ${kpis.length} KPI definitions`);
  } catch (err) {
    // Table might not exist yet
    console.log('seedKpisIfEmpty skipped:', err.message);
  }
}

/**
 * Idempotent migration: add customer hierarchy columns if they don't exist.
 */
async function migrateCustomerColumns(db) {
  try {
    const cols = await db.prepare("SELECT name FROM pragma_table_info('customers')").all();
    const colNames = cols.map(c => c.name);
    const additions = [
      { name: 'channel_name', sql: "ALTER TABLE customers ADD COLUMN channel_name TEXT" },
      { name: 'customer_group', sql: "ALTER TABLE customers ADD COLUMN customer_group TEXT" },
      { name: 'customer_group_name', sql: "ALTER TABLE customers ADD COLUMN customer_group_name TEXT" },
    ];
    let added = 0;
    for (const col of additions) {
      if (!colNames.includes(col.name)) {
        await db.prepare(col.sql).run();
        added++;
      }
    }
    if (added > 0) console.log(`Migrated customers table: added ${added} columns`);
  } catch {
    // Table might not exist yet
  }
}

/**
 * Idempotent migration: add external_id column to employees table.
 */
async function migrateEmployeeExternalId(db) {
  try {
    const cols = await db.prepare("SELECT name FROM pragma_table_info('employees')").all();
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('external_id')) {
      await db.prepare("ALTER TABLE employees ADD COLUMN external_id TEXT").run();
      console.log('Migrated employees table: added external_id column');
    }
    // Ensure index exists (CREATE INDEX IF NOT EXISTS is safe to run always)
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_employees_external_id ON employees(external_id)").run();
  } catch {
    // Table might not exist yet
  }
}

/**
 * Idempotent migration: convert legacy free-text formulas to structured JSON.
 */
async function migrateFormulas(db) {
  const formulaMap = {
    'TOTAL_REVENUE': { type: 'simple', aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [] },
    'UNITS_SOLD': { type: 'simple', aggregation: 'SUM', field: 'quantity', transactionType: 'sale', filters: [] },
    'OUTLET_COVERAGE': { type: 'simple', aggregation: 'COUNT_DISTINCT', field: 'customer_id', transactionType: 'sale', filters: [] },
    'STRATEGIC_SKU_REV': { type: 'simple', aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [{ field: 'is_strategic', operator: '=', value: 1 }] },
    'NEW_LAUNCH_SALES': { type: 'simple', aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [{ field: 'is_new_launch', operator: '=', value: 1 }] },
    'NEW_CUSTOMERS': { type: 'simple', aggregation: 'COUNT_DISTINCT', field: 'customer_id', transactionType: 'sale', filters: [] },
    'COLLECTION_PERCENT': { type: 'ratio', numerator: { aggregation: 'SUM', field: 'amount', transactionType: 'collection', filters: [] }, denominator: { aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [] }, multiplyBy: 100 },
    'RETURN_PERCENT': { type: 'ratio', numerator: { aggregation: 'SUM', field: 'amount', transactionType: 'return', filters: [] }, denominator: { aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [] }, multiplyBy: 100 },
    'LINES_PER_CALL': { type: 'ratio', numerator: { aggregation: 'COUNT_DISTINCT', field: 'product_id', transactionType: 'sale', filters: [] }, denominator: { aggregation: 'COUNT_DISTINCT', field: 'customer_id', transactionType: 'sale', filters: [] }, multiplyBy: 1 },
    'REV_PER_OUTLET': { type: 'ratio', numerator: { aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [] }, denominator: { aggregation: 'COUNT_DISTINCT', field: 'customer_id', transactionType: 'sale', filters: [] }, multiplyBy: 1 },
    'REVENUE_GROWTH': { type: 'growth', baseMetric: { aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [] }, compareWith: 'previous_year' },
    'TEAM_REVENUE': { type: 'team', baseMetric: { aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [] }, teamAggregation: 'SUM' },
    'TEAM_TARGET_ACH': { type: 'static', defaultValue: 90, source: 'external' },
    'OTD_PERCENT': { type: 'static', defaultValue: 92, source: 'external' },
    'GROSS_MARGIN': { type: 'static', defaultValue: 28, source: 'external' },
  };

  try {
    const kpis = await db.prepare('SELECT id, code, formula FROM kpi_definitions').all();
    if (kpis.length === 0) return;

    let migrated = 0;
    for (const kpi of kpis) {
      try {
        const parsed = JSON.parse(kpi.formula);
        if (parsed && typeof parsed === 'object' && parsed.type) continue;
      } catch { /* not JSON, needs migration */ }

      const structured = formulaMap[kpi.code];
      if (structured) {
        await db.prepare('UPDATE kpi_definitions SET formula = ? WHERE id = ?').run(JSON.stringify(structured), kpi.id);
        migrated++;
      }
    }
    if (migrated > 0) {
      console.log(`Migrated ${migrated} KPI formulas to structured JSON`);
    }
  } catch {
    // Table might not exist yet
  }
}

/**
 * §5, §22, §23 migrations — idempotent column additions on existing tables.
 */
async function migrateAdvancedFeatures(db) {
  // Add currency column to commission_plans
  try {
    const cols = await db.prepare("SELECT name FROM pragma_table_info('commission_plans')").all();
    const names = cols.map(c => c.name);
    if (!names.includes('currency')) {
      await db.prepare("ALTER TABLE commission_plans ADD COLUMN currency TEXT DEFAULT 'AED'").run();
      console.log('Migrated commission_plans: added currency column');
    }
  } catch {}

  // Add currency & exchange_rate columns to transactions
  try {
    const cols = await db.prepare("SELECT name FROM pragma_table_info('transactions')").all();
    const names = cols.map(c => c.name);
    if (!names.includes('currency')) {
      await db.prepare("ALTER TABLE transactions ADD COLUMN currency TEXT DEFAULT 'AED'").run();
    }
    if (!names.includes('exchange_rate')) {
      await db.prepare("ALTER TABLE transactions ADD COLUMN exchange_rate REAL DEFAULT 1.0").run();
    }
    if (!names.includes('base_amount')) {
      await db.prepare("ALTER TABLE transactions ADD COLUMN base_amount REAL").run();
    }
  } catch {}

  // Add event_type to KPI definitions (for event-triggered KPIs)
  try {
    const cols = await db.prepare("SELECT name FROM pragma_table_info('kpi_definitions')").all();
    const names = cols.map(c => c.name);
    if (!names.includes('trigger_type')) {
      await db.prepare("ALTER TABLE kpi_definitions ADD COLUMN trigger_type TEXT DEFAULT 'transaction'").run();
    }
    if (!names.includes('event_type')) {
      await db.prepare("ALTER TABLE kpi_definitions ADD COLUMN event_type TEXT").run();
    }
  } catch {}

  // Add valid_from, valid_to, conditional_logic to rules for §22.7 & §22.10
  try {
    const cols = await db.prepare("SELECT name FROM pragma_table_info('rules')").all();
    const names = cols.map(c => c.name);
    if (!names.includes('valid_from')) {
      await db.prepare("ALTER TABLE rules ADD COLUMN valid_from TEXT").run();
    }
    if (!names.includes('valid_to')) {
      await db.prepare("ALTER TABLE rules ADD COLUMN valid_to TEXT").run();
    }
    if (!names.includes('conditional_logic')) {
      await db.prepare("ALTER TABLE rules ADD COLUMN conditional_logic TEXT").run();
    }
    if (!names.includes('parent_rule_id')) {
      await db.prepare("ALTER TABLE rules ADD COLUMN parent_rule_id TEXT").run();
    }
  } catch {}

  // Add trip_end_date + days_count to trips for multi-day support
  try {
    const cols = await db.prepare("SELECT name FROM pragma_table_info('trips')").all();
    const names = cols.map(c => c.name);
    if (!names.includes('trip_end_date')) {
      await db.prepare("ALTER TABLE trips ADD COLUMN trip_end_date TEXT").run();
    }
    if (!names.includes('days_count')) {
      await db.prepare("ALTER TABLE trips ADD COLUMN days_count INTEGER DEFAULT 1").run();
    }
  } catch {}
}

/**
 * Seed reference data for advanced features: currencies, tags, sample events,
 * perfect store audits, and territory history — all idempotent with INSERT OR IGNORE.
 */
async function seedAdvancedFeatureData(db) {
  try {
    // --- CURRENCIES (§23) ---
    const ccyCount = await db.prepare('SELECT COUNT(*) as c FROM currencies').get();
    if (ccyCount.c === 0) {
      const currencies = [
        { code: 'AED', name: 'UAE Dirham', symbol: 'AED', is_base: 1, country: 'UAE' },
        { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', is_base: 0, country: 'Saudi Arabia' },
        { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KWD', is_base: 0, country: 'Kuwait' },
        { code: 'QAR', name: 'Qatari Riyal', symbol: 'QAR', is_base: 0, country: 'Qatar' },
        { code: 'BHD', name: 'Bahraini Dinar', symbol: 'BHD', is_base: 0, country: 'Bahrain' },
        { code: 'OMR', name: 'Omani Rial', symbol: 'OMR', is_base: 0, country: 'Oman' },
        { code: 'INR', name: 'Indian Rupee', symbol: '₹', is_base: 0, country: 'India' },
        { code: 'USD', name: 'US Dollar', symbol: '$', is_base: 0, country: 'United States' },
        { code: 'EUR', name: 'Euro', symbol: '€', is_base: 0, country: 'Eurozone' },
        { code: 'GBP', name: 'British Pound', symbol: '£', is_base: 0, country: 'United Kingdom' },
      ];
      await db.batch(currencies.map(c => ({
        sql: 'INSERT OR IGNORE INTO currencies (code, name, symbol, is_base, country) VALUES (?, ?, ?, ?, ?)',
        args: [c.code, c.name, c.symbol, c.is_base, c.country],
      })));
      console.log(`Seeded ${currencies.length} currencies`);
    }

    // --- EXCHANGE RATES (base: AED) ---
    const rateCount = await db.prepare('SELECT COUNT(*) as c FROM exchange_rates').get();
    if (rateCount.c === 0) {
      const today = new Date().toISOString().split('T')[0];
      const rates = [
        { from: 'AED', to: 'AED', rate: 1.0 },
        { from: 'AED', to: 'SAR', rate: 1.022 },
        { from: 'AED', to: 'KWD', rate: 0.0834 },
        { from: 'AED', to: 'QAR', rate: 0.9924 },
        { from: 'AED', to: 'BHD', rate: 0.1027 },
        { from: 'AED', to: 'OMR', rate: 0.1048 },
        { from: 'AED', to: 'INR', rate: 23.15 },
        { from: 'AED', to: 'USD', rate: 0.2723 },
        { from: 'AED', to: 'EUR', rate: 0.2510 },
        { from: 'AED', to: 'GBP', rate: 0.2145 },
      ];
      await db.batch(rates.map(r => ({
        sql: 'INSERT OR IGNORE INTO exchange_rates (id, from_currency, to_currency, rate, effective_date) VALUES (?, ?, ?, ?, ?)',
        args: [uuid(), r.from, r.to, r.rate, today],
      })));
      console.log(`Seeded ${rates.length} exchange rates`);
    }

    // --- TAGS (§22.8) ---
    const tagCount = await db.prepare('SELECT COUNT(*) as c FROM tags').get();
    if (tagCount.c === 0) {
      const tags = [
        { id: 'tag-strategic', name: 'Strategic SKU', category: 'product', color: '#8b5cf6', description: 'High-priority strategic product' },
        { id: 'tag-low-margin', name: 'Low Margin SKU', category: 'product', color: '#ef4444', description: 'Margin below 5% threshold' },
        { id: 'tag-seasonal', name: 'Seasonal SKU', category: 'product', color: '#f59e0b', description: 'Available only in specific seasons' },
        { id: 'tag-new-launch', name: 'New Launch', category: 'product', color: '#10b981', description: 'Recently launched product' },
        { id: 'tag-export', name: 'Export SKU', category: 'product', color: '#06b6d4', description: 'For export markets only' },
        { id: 'tag-internal-use', name: 'Internal Use SKU', category: 'product', color: '#64748b', description: 'Internal use, no commission' },
        { id: 'tag-contract-cust', name: 'Contract Customer', category: 'customer', color: '#6366f1', description: 'Special pricing contract' },
        { id: 'tag-gov', name: 'Government Customer', category: 'customer', color: '#3b82f6', description: 'Government account' },
        { id: 'tag-blacklist', name: 'Blacklisted Customer', category: 'customer', color: '#dc2626', description: 'Excluded from commissions' },
        { id: 'tag-key-account', name: 'Key Account', category: 'customer', color: '#8b5cf6', description: 'Named key account' },
        { id: 'tag-pilot-market', name: 'Pilot Market', category: 'territory', color: '#f59e0b', description: 'Pilot test territory' },
        { id: 'tag-metro', name: 'Strategic Metro', category: 'territory', color: '#10b981', description: 'Strategic metropolitan city' },
        { id: 'tag-rural', name: 'Rural Route', category: 'territory', color: '#84cc16', description: 'Rural territory' },
        { id: 'tag-interim-mgr', name: 'Interim Manager', category: 'employee', color: '#f97316', description: 'Temporary/interim management role' },
      ];
      await db.batch(tags.map(t => ({
        sql: 'INSERT OR IGNORE INTO tags (id, name, category, color, description) VALUES (?, ?, ?, ?, ?)',
        args: [t.id, t.name, t.category, t.color, t.description],
      })));
      console.log(`Seeded ${tags.length} tags`);

      // Auto-apply tags to seeded products based on their flags
      const strategicProds = await db.prepare("SELECT id FROM products WHERE is_strategic = 1").all();
      const newLaunchProds = await db.prepare("SELECT id FROM products WHERE is_new_launch = 1").all();
      const tagStmts = [
        ...strategicProds.map(p => ({ sql: 'INSERT OR IGNORE INTO entity_tags (id, tag_id, entity_type, entity_id) VALUES (?, ?, ?, ?)', args: [uuid(), 'tag-strategic', 'product', p.id] })),
        ...newLaunchProds.map(p => ({ sql: 'INSERT OR IGNORE INTO entity_tags (id, tag_id, entity_type, entity_id) VALUES (?, ?, ?, ?)', args: [uuid(), 'tag-new-launch', 'product', p.id] })),
      ];
      if (tagStmts.length > 0) {
        await db.batch(tagStmts);
        console.log(`Auto-tagged ${tagStmts.length} products`);
      }
    }

    // --- SAMPLE COMMISSION EVENTS (§5) ---
    const evtCount = await db.prepare('SELECT COUNT(*) as c FROM commission_events').get();
    if (evtCount.c === 0) {
      const employees = await db.prepare("SELECT id FROM employees WHERE role_id LIKE 'role-%' LIMIT 6").all();
      if (employees.length > 0) {
        const eventTypes = [
          { type: 'delivery_confirmation', value: 1, desc: 'Successful delivery confirmed' },
          { type: 'collection_posting', value: 2500, desc: 'Collection posted to GL' },
          { type: 'beat_compliance', value: 1, desc: 'Beat completed on schedule' },
          { type: 'gps_route', value: 1, desc: 'GPS route completed' },
          { type: 'attendance', value: 1, desc: 'Attendance validated' },
          { type: 'image_verification', value: 1, desc: 'Merchandising photo approved' },
          { type: 'audit_score', value: 85, desc: 'Store audit completed' },
          { type: 'asset_installation', value: 1, desc: 'Cooler installation verified' },
          { type: 'campaign_completion', value: 1, desc: 'Q1 campaign fully executed' },
        ];
        const events = [];
        let dayOffset = 1;
        for (const emp of employees) {
          for (const et of eventTypes) {
            events.push({
              id: uuid(),
              event_type: et.type,
              employee_id: emp.id,
              reference_type: 'system',
              reference_id: `ref-${Math.floor(Math.random() * 10000)}`,
              value: et.value,
              metadata: JSON.stringify({ description: et.desc, auto_generated: true }),
              event_date: `2026-01-${String((dayOffset++ % 28) + 1).padStart(2, '0')}`,
              period: '2026-01',
              validated: 1,
            });
          }
        }
        for (let i = 0; i < events.length; i += 50) {
          const chunk = events.slice(i, i + 50);
          await db.batch(chunk.map(e => ({
            sql: 'INSERT OR IGNORE INTO commission_events (id, event_type, employee_id, reference_id, reference_type, value, metadata, event_date, period, validated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            args: [e.id, e.event_type, e.employee_id, e.reference_id, e.reference_type, e.value, e.metadata, e.event_date, e.period, e.validated],
          })));
        }
        console.log(`Seeded ${events.length} commission events`);
      }
    }

    // --- PERFECT STORE AUDITS (§15) ---
    const psCount = await db.prepare('SELECT COUNT(*) as c FROM perfect_store_audits').get();
    if (psCount.c === 0) {
      const employees = await db.prepare("SELECT id, territory_id FROM employees WHERE role_id IN ('role-salesman','role-pre-sales','role-van-sales','role-merchandiser')").all();
      const customers = await db.prepare('SELECT id, territory_id FROM customers').all();
      const audits = [];
      for (const emp of employees) {
        const custsInTerr = customers.filter(c => c.territory_id === emp.territory_id);
        const targetCusts = custsInTerr.length > 0 ? custsInTerr : customers.slice(0, 2);
        for (const c of targetCusts) {
          // Generate varied realistic scores (60-95 range)
          const scores = {
            assortment: 60 + Math.floor(Math.random() * 35),
            pricing: 70 + Math.floor(Math.random() * 25),
            shelf_share: 55 + Math.floor(Math.random() * 40),
            promotion: 65 + Math.floor(Math.random() * 30),
            visibility: 60 + Math.floor(Math.random() * 35),
            cleanliness: 75 + Math.floor(Math.random() * 20),
            stock: 70 + Math.floor(Math.random() * 25),
          };
          // Weighted composite (default weights: 20/15/15/15/15/10/10)
          const composite = (scores.assortment * 0.20) + (scores.pricing * 0.15) + (scores.shelf_share * 0.15)
                          + (scores.promotion * 0.15) + (scores.visibility * 0.15) + (scores.cleanliness * 0.10)
                          + (scores.stock * 0.10);
          audits.push({
            id: uuid(),
            employee_id: emp.id,
            customer_id: c.id,
            period: '2026-01',
            scores,
            composite: Math.round(composite * 100) / 100,
          });
        }
      }
      for (let i = 0; i < audits.length; i += 50) {
        const chunk = audits.slice(i, i + 50);
        await db.batch(chunk.map(a => ({
          sql: `INSERT OR IGNORE INTO perfect_store_audits (id, employee_id, customer_id, period, assortment_score, pricing_score, shelf_share_score, promotion_score, visibility_score, cleanliness_score, stock_availability_score, composite_score, audited_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [a.id, a.employee_id, a.customer_id, a.period, a.scores.assortment, a.scores.pricing, a.scores.shelf_share, a.scores.promotion, a.scores.visibility, a.scores.cleanliness, a.scores.stock, a.composite, 'system'],
        })));
      }
      console.log(`Seeded ${audits.length} perfect store audits`);

      // Default Perfect Store weights
      await db.prepare(`INSERT OR IGNORE INTO perfect_store_weights (id, plan_id, assortment_weight, pricing_weight, shelf_share_weight, promotion_weight, visibility_weight, cleanliness_weight, stock_availability_weight)
        VALUES ('ps-weight-default', NULL, 20, 15, 15, 15, 15, 10, 10)`).run();
    }

    // --- HELPER TRIP RATES (default tiers) — wrapped so DB without tables won't crash boot
    try {
      const rateCount = await db.prepare('SELECT COUNT(*) as c FROM helper_trip_rates WHERE plan_id IS NULL').get();
      if (rateCount.c === 0) {
        const defaultRates = [
          { team_size: 1, rate_per_person: 12 },
          { team_size: 2, rate_per_person: 7 },
          { team_size: 3, rate_per_person: 5 },
          { team_size: 4, rate_per_person: 4 },
        ];
        for (const r of defaultRates) {
          await db.prepare('INSERT OR IGNORE INTO helper_trip_rates (id, plan_id, team_size, rate_per_person, currency) VALUES (?, NULL, ?, ?, ?)')
            .run(uuid(), r.team_size, r.rate_per_person, 'AED');
        }
        console.log(`Seeded ${defaultRates.length} default helper trip rates`);
      }
    } catch (err) {
      console.log('helper_trip_rates seed skipped:', err.message);
    }

    // --- SAMPLE TRIPS ---
    let tripCount;
    try {
      tripCount = await db.prepare('SELECT COUNT(*) as c FROM trips').get();
    } catch {
      tripCount = { c: 1 }; // table missing, skip seeding
    }
    if (tripCount.c === 0) {
      try {
      const delivery = await db.prepare("SELECT id FROM employees WHERE role_id IN ('role-delivery','role-van-driver','role-van-sales')").all();
      if (delivery.length >= 2) {
        const trips = [];
        // 10 solo trips for first driver
        for (let i = 1; i <= 10; i++) {
          trips.push({
            id: uuid(),
            trip_number: `TRIP-2026-${String(i).padStart(4, '0')}`,
            trip_date: `2026-01-${String(i).padStart(2, '0')}`,
            period: '2026-01',
            stops_count: 10 + Math.floor(Math.random() * 15),
            distance_km: 50 + Math.floor(Math.random() * 100),
            participants: [delivery[0].id],
          });
        }
        // 8 paired trips (2 helpers)
        for (let i = 11; i <= 18; i++) {
          trips.push({
            id: uuid(),
            trip_number: `TRIP-2026-${String(i).padStart(4, '0')}`,
            trip_date: `2026-01-${String(i).padStart(2, '0')}`,
            period: '2026-01',
            stops_count: 15 + Math.floor(Math.random() * 20),
            distance_km: 80 + Math.floor(Math.random() * 100),
            participants: [delivery[0].id, delivery[1].id],
          });
        }
        // 5 team trips (3 helpers) if we have enough drivers
        if (delivery.length >= 3) {
          for (let i = 19; i <= 23; i++) {
            trips.push({
              id: uuid(),
              trip_number: `TRIP-2026-${String(i).padStart(4, '0')}`,
              trip_date: `2026-01-${String(i).padStart(2, '0')}`,
              period: '2026-01',
              stops_count: 25 + Math.floor(Math.random() * 15),
              distance_km: 120 + Math.floor(Math.random() * 100),
              participants: [delivery[0].id, delivery[1].id, delivery[2].id],
            });
          }
        }

        for (const t of trips) {
          await db.prepare('INSERT OR IGNORE INTO trips (id, trip_number, trip_date, period, stops_count, distance_km, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(t.id, t.trip_number, t.trip_date, t.period, t.stops_count, t.distance_km, 'completed');
          for (const empId of t.participants) {
            await db.prepare('INSERT OR IGNORE INTO trip_participants (id, trip_id, employee_id, role_on_trip) VALUES (?, ?, ?, ?)')
              .run(uuid(), t.id, empId, 'helper');
          }
        }
        console.log(`Seeded ${trips.length} sample trips with participants`);
      }
      } catch (err) {
        console.log('trips seed skipped:', err.message);
      }
    }

    // --- EMPLOYEE TERRITORY HISTORY (§23) ---
    const hCount = await db.prepare('SELECT COUNT(*) as c FROM employee_territory_history').get();
    if (hCount.c === 0) {
      const employees = await db.prepare('SELECT id, territory_id, hire_date FROM employees WHERE territory_id IS NOT NULL').all();
      if (employees.length > 0) {
        await db.batch(employees.map(e => ({
          sql: 'INSERT OR IGNORE INTO employee_territory_history (id, employee_id, territory_id, effective_from, effective_to, transfer_reason) VALUES (?, ?, ?, ?, NULL, ?)',
          args: [uuid(), e.id, e.territory_id, e.hire_date || '2020-01-01', 'Initial assignment'],
        })));
        console.log(`Seeded ${employees.length} employee territory history records`);
      }
    }

    // --- TIME-BOUND & CONDITIONAL SAMPLE RULES (§22.10, §22.7) ---
    const samplePlan = await db.prepare("SELECT id FROM commission_plans WHERE id = 'plan-01'").get();
    if (samplePlan) {
      const trRule = await db.prepare("SELECT id FROM rule_sets WHERE id = 'rs-timebound'").get();
      if (!trRule) {
        await db.prepare("INSERT OR IGNORE INTO rule_sets (id, plan_id, name, description) VALUES ('rs-timebound', 'plan-01', 'Time-Bound Promo Rules', 'Seasonal and campaign-specific rule set (§22.10)')").run();
        await db.prepare(`INSERT OR IGNORE INTO rules (id, rule_set_id, dimension, rule_type, match_type, match_values, priority, valid_from, valid_to)
          VALUES (?, 'rs-timebound', 'product', 'include', 'tag', '["tag-new-launch"]', 1, '2026-01-01', '2026-03-31')`).run(uuid());
        const condLogic = JSON.stringify({ if: { field: 'customer_channel', op: '=', value: 'GT' }, then: 'apply', else: 'skip' });
        await db.prepare(`INSERT OR IGNORE INTO rules (id, rule_set_id, dimension, rule_type, match_type, match_values, priority, valid_from, valid_to, conditional_logic)
          VALUES (?, 'rs-timebound', 'customer', 'exclude', 'tag', '["tag-blacklist"]', 2, NULL, NULL, ?)`).run(uuid(), condLogic);
      }
    }
  } catch (err) {
    console.log('seedAdvancedFeatureData skipped:', err.message);
  }
}

/**
 * Seed the extended KPI library per WINIT SFA spec §8 — covers all 9 categories:
 * Sales, Distribution, Productivity, Financial, Merchandising, Asset,
 * Trade Marketing, Inventory & Freshness, Behavioral & Compliance.
 *
 * KPIs that require external data (asset mgmt, merchandising audits, attendance)
 * are seeded as `static` formulas — their actual values would come from integrated
 * systems in production.
 */
async function seedExtendedKpiLibrary(db) {
  try {
    const simple = (agg, field, txType = 'sale', filters = []) =>
      JSON.stringify({ type: 'simple', aggregation: agg, field, transactionType: txType, filters });
    const ratio = (num, den, mult = 100) =>
      JSON.stringify({ type: 'ratio', numerator: num, denominator: den, multiplyBy: mult });
    const growth = (agg, field) =>
      JSON.stringify({ type: 'growth', baseMetric: { aggregation: agg, field, transactionType: 'sale', filters: [] }, compareWith: 'previous_year' });
    const team = (agg, field) =>
      JSON.stringify({ type: 'team', baseMetric: { aggregation: agg, field, transactionType: 'sale', filters: [] }, teamAggregation: 'SUM' });
    const stat = (val) => JSON.stringify({ type: 'static', defaultValue: val, source: 'external' });

    const allRoles = '["role-pre-sales","role-van-sales","role-delivery","role-merchandiser","role-trade-mkt","role-ka-exec","role-ss","role-asm","role-rsm","role-nsm","role-salesman","role-van-driver"]';
    const fieldRoles = '["role-pre-sales","role-van-sales","role-merchandiser","role-salesman","role-van-driver"]';
    const mgrRoles = '["role-ss","role-asm","role-rsm","role-nsm","role-route-sup","role-depot-mgr","role-sales-mgr","role-gm"]';
    const deliveryRoles = '["role-delivery"]';
    const tmRoles = '["role-trade-mkt"]';
    const kaRoles = '["role-ka-exec","role-ka-mgr"]';
    const merchRoles = '["role-merchandiser"]';

    const kpis = [
      // ==================== 8.1 SALES KPIs ====================
      { id: 'kpi-s01', name: 'Sales by Brand', code: 'SALES_BY_BRAND', category: 'Sales', description: 'Sales value by specific brand', formula: simple('SUM', 'amount'), unit: 'currency', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-s02', name: 'Sales by Category', code: 'SALES_BY_CATEGORY', category: 'Sales', description: 'Sales value by product category', formula: simple('SUM', 'amount'), unit: 'currency', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-s03', name: 'Sales by SKU', code: 'SALES_BY_SKU', category: 'Sales', description: 'Sales value by specific SKU', formula: simple('SUM', 'amount'), unit: 'currency', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-s04', name: 'Same-Store Growth %', code: 'SAME_STORE_GROWTH', category: 'Sales', description: 'Growth in outlets that existed in both periods', formula: stat(8), unit: 'percentage', direction: 'higher_is_better', applicable_roles: allRoles },
      { id: 'kpi-s05', name: 'Like-for-Like Growth %', code: 'LFL_GROWTH', category: 'Sales', description: 'Growth excluding new outlets and closed outlets', formula: stat(7), unit: 'percentage', direction: 'higher_is_better', applicable_roles: allRoles },
      { id: 'kpi-s06', name: 'Premium SKU Growth %', code: 'PREMIUM_SKU_GROWTH', category: 'Sales', description: 'Growth in premium-tier SKU sales', formula: growth('SUM', 'amount'), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-s07', name: 'New Product Penetration %', code: 'NPD_PENETRATION', category: 'Sales', description: 'Percentage of outlets stocking new products', formula: stat(45), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-s08', name: 'Promo Uplift %', code: 'PROMO_UPLIFT', category: 'Sales', description: 'Sales uplift during promotional periods vs baseline', formula: stat(25), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-s09', name: 'Channel Growth %', code: 'CHANNEL_GROWTH', category: 'Sales', description: 'Growth within a specific sales channel', formula: growth('SUM', 'amount'), unit: 'percentage', direction: 'higher_is_better', applicable_roles: allRoles },

      // ==================== 8.2 DISTRIBUTION KPIs ====================
      { id: 'kpi-d01', name: 'Numeric Distribution %', code: 'NUMERIC_DIST', category: 'Distribution', description: '% of outlets in territory stocking the product', formula: stat(75), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-d02', name: 'Weighted Distribution %', code: 'WEIGHTED_DIST', category: 'Distribution', description: 'Distribution weighted by outlet sales contribution', formula: stat(82), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-d03', name: 'MSL Compliance %', code: 'MSL_COMPLIANCE', category: 'Distribution', description: 'Must-Stock-List compliance across outlets', formula: stat(88), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-d04', name: 'SKU Penetration %', code: 'SKU_PENETRATION', category: 'Distribution', description: '% of outlets stocking each SKU', formula: stat(70), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-d05', name: 'Active Outlet Growth %', code: 'ACTIVE_OUTLET_GROWTH', category: 'Distribution', description: 'Growth in number of active (transacting) outlets', formula: stat(12), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-d06', name: 'Depth of Distribution', code: 'DIST_DEPTH', category: 'Distribution', description: 'Average number of SKUs stocked per outlet', formula: stat(18), unit: 'number', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-d07', name: 'Range Selling %', code: 'RANGE_SELLING', category: 'Distribution', description: '% of full product range sold to each outlet', formula: stat(65), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-d08', name: 'Perfect Store Index', code: 'PERFECT_STORE_IDX', category: 'Distribution', description: 'Composite score: assortment + pricing + shelf + promo + visibility', formula: stat(78), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },

      // ==================== 8.3 PRODUCTIVITY KPIs ====================
      { id: 'kpi-p01', name: 'Call Coverage %', code: 'CALL_COVERAGE', category: 'Productivity', description: 'Planned calls completed / planned calls', formula: stat(92), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-p02', name: 'Productive Calls %', code: 'PRODUCTIVE_CALLS', category: 'Productivity', description: 'Calls resulting in an order / total calls', formula: stat(75), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-p03', name: 'Strike Rate %', code: 'STRIKE_RATE', category: 'Productivity', description: 'Orders / visits', formula: stat(70), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-p04', name: 'Lines Per Bill', code: 'LINES_PER_BILL', category: 'Productivity', description: 'Average distinct SKUs per invoice', formula: stat(6), unit: 'number', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-p05', name: 'Average Drop Size', code: 'DROP_SIZE', category: 'Productivity', description: 'Average sales value per drop/invoice', formula: ratio({ aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [] }, { aggregation: 'COUNT_DISTINCT', field: 'customer_id', transactionType: 'sale', filters: [] }, 1), unit: 'currency', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-p06', name: 'Revenue Per Call', code: 'REV_PER_CALL', category: 'Productivity', description: 'Revenue generated per customer call', formula: stat(450), unit: 'currency', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-p07', name: 'Revenue Per Route', code: 'REV_PER_ROUTE', category: 'Productivity', description: 'Revenue per route per day', formula: stat(5500), unit: 'currency', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-p08', name: 'Route Adherence %', code: 'ROUTE_ADHERENCE', category: 'Productivity', description: 'GPS-verified adherence to planned route', formula: stat(87), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-p09', name: 'Beat Compliance %', code: 'BEAT_COMPLIANCE', category: 'Productivity', description: 'Scheduled beat visits completed on time', formula: stat(90), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-p10', name: 'Planned vs Actual Visits %', code: 'PLANNED_ACTUAL', category: 'Productivity', description: 'Actual visits / planned visits', formula: stat(94), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-p11', name: 'Zero Sales Outlet %', code: 'ZERO_SALES_OUTLET', category: 'Productivity', description: '% of visited outlets with no sale', formula: stat(15), unit: 'percentage', direction: 'lower_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-p12', name: 'Untouched Outlet %', code: 'UNTOUCHED_OUTLET', category: 'Productivity', description: '% of planned outlets not visited', formula: stat(8), unit: 'percentage', direction: 'lower_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-p13', name: 'Idle Time %', code: 'IDLE_TIME', category: 'Productivity', description: 'Non-productive time during working hours', formula: stat(12), unit: 'percentage', direction: 'lower_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-p14', name: 'Visit Duration Compliance %', code: 'VISIT_DURATION', category: 'Productivity', description: 'Visits within target duration window', formula: stat(85), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },

      // ==================== 8.4 FINANCIAL KPIs ====================
      { id: 'kpi-f01', name: 'Collection Achievement %', code: 'COLLECTION_ACH', category: 'Financial', description: 'Collected amount / target collection', formula: stat(92), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-f02', name: 'DSO (Days Sales Outstanding)', code: 'DSO', category: 'Financial', description: 'Average days to collect receivables', formula: stat(28), unit: 'number', direction: 'lower_is_better', applicable_roles: allRoles },
      { id: 'kpi-f03', name: 'AR Aging %', code: 'AR_AGING', category: 'Financial', description: '% of AR beyond 60 days', formula: stat(10), unit: 'percentage', direction: 'lower_is_better', applicable_roles: allRoles },
      { id: 'kpi-f04', name: 'Overdue %', code: 'OVERDUE_PCT', category: 'Financial', description: '% of overdue receivables', formula: stat(12), unit: 'percentage', direction: 'lower_is_better', applicable_roles: allRoles },
      { id: 'kpi-f05', name: 'Damage %', code: 'DAMAGE_PCT', category: 'Financial', description: 'Damaged goods as % of sales', formula: stat(2), unit: 'percentage', direction: 'lower_is_better', applicable_roles: allRoles },
      { id: 'kpi-f06', name: 'Expiry %', code: 'EXPIRY_PCT', category: 'Financial', description: 'Expired stock as % of sales', formula: stat(1.5), unit: 'percentage', direction: 'lower_is_better', applicable_roles: allRoles },
      { id: 'kpi-f07', name: 'Credit Note Control %', code: 'CREDIT_NOTE', category: 'Financial', description: 'Credit notes issued / invoices', formula: stat(3), unit: 'percentage', direction: 'lower_is_better', applicable_roles: allRoles },
      { id: 'kpi-f08', name: 'Bad Debt %', code: 'BAD_DEBT', category: 'Financial', description: 'Bad debt write-offs / sales', formula: stat(1), unit: 'percentage', direction: 'lower_is_better', applicable_roles: mgrRoles },
      { id: 'kpi-f09', name: 'Gross Margin Contribution', code: 'GM_CONTRIB', category: 'Financial', description: 'Gross margin generated (absolute)', formula: stat(35000), unit: 'currency', direction: 'higher_is_better', applicable_roles: mgrRoles },

      // ==================== 8.5 MERCHANDISING KPIs ====================
      { id: 'kpi-m01', name: 'Planogram Compliance %', code: 'PLANOGRAM', category: 'Merchandising', description: 'Shelves arranged per approved planogram', formula: stat(82), unit: 'percentage', direction: 'higher_is_better', applicable_roles: merchRoles },
      { id: 'kpi-m02', name: 'Shelf Share %', code: 'SHELF_SHARE', category: 'Merchandising', description: 'Our shelf facings / total shelf facings', formula: stat(28), unit: 'percentage', direction: 'higher_is_better', applicable_roles: merchRoles },
      { id: 'kpi-m03', name: 'Facing Compliance %', code: 'FACING_COMPLIANCE', category: 'Merchandising', description: 'Facings meet target count', formula: stat(85), unit: 'percentage', direction: 'higher_is_better', applicable_roles: merchRoles },
      { id: 'kpi-m04', name: 'OOS Reduction %', code: 'OOS_REDUCTION', category: 'Merchandising', description: 'Reduction in out-of-stock incidents vs baseline', formula: stat(22), unit: 'percentage', direction: 'higher_is_better', applicable_roles: merchRoles },
      { id: 'kpi-m05', name: 'Price Tag Compliance %', code: 'PRICE_TAG', category: 'Merchandising', description: 'SKUs with correct price tags', formula: stat(93), unit: 'percentage', direction: 'higher_is_better', applicable_roles: merchRoles },
      { id: 'kpi-m06', name: 'Display Compliance %', code: 'DISPLAY_COMPLIANCE', category: 'Merchandising', description: 'Planned displays in place', formula: stat(88), unit: 'percentage', direction: 'higher_is_better', applicable_roles: merchRoles },
      { id: 'kpi-m07', name: 'Secondary Placement Compliance %', code: 'SECONDARY_PLACEMENT', category: 'Merchandising', description: 'Secondary shelf / end-cap placements', formula: stat(75), unit: 'percentage', direction: 'higher_is_better', applicable_roles: merchRoles },
      { id: 'kpi-m08', name: 'Visibility Score', code: 'VISIBILITY_SCORE', category: 'Merchandising', description: 'In-store brand visibility index', formula: stat(80), unit: 'number', direction: 'higher_is_better', applicable_roles: merchRoles },
      { id: 'kpi-m09', name: 'Image Verification Score %', code: 'IMAGE_VERIFY', category: 'Merchandising', description: 'Photos verified by AI/supervisor', formula: stat(90), unit: 'percentage', direction: 'higher_is_better', applicable_roles: merchRoles },
      { id: 'kpi-m10', name: 'Competitor Reporting Compliance %', code: 'COMPETITOR_REPORT', category: 'Merchandising', description: 'Competitor data submitted per plan', formula: stat(85), unit: 'percentage', direction: 'higher_is_better', applicable_roles: merchRoles },

      // ==================== 8.6 ASSET KPIs ====================
      { id: 'kpi-a01', name: 'Cooler Placement Count', code: 'COOLER_PLACE', category: 'Asset', description: 'Number of approved cooler installations', formula: stat(5), unit: 'number', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-a02', name: 'Rack Installation Count', code: 'RACK_INSTALL', category: 'Asset', description: 'Number of approved rack installations', formula: stat(8), unit: 'number', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-a03', name: 'Secondary Display Installation', code: 'SEC_DISPLAY_INSTALL', category: 'Asset', description: 'Secondary displays installed', formula: stat(12), unit: 'number', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-a04', name: 'Asset Utilization %', code: 'ASSET_UTIL', category: 'Asset', description: 'Active assets / total deployed', formula: stat(88), unit: 'percentage', direction: 'higher_is_better', applicable_roles: allRoles },
      { id: 'kpi-a05', name: 'Cooler Uptime %', code: 'COOLER_UPTIME', category: 'Asset', description: 'Cooler operational uptime', formula: stat(95), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-a06', name: 'Branding Compliance %', code: 'BRANDING_COMPLIANCE', category: 'Asset', description: 'Asset branding per standards', formula: stat(90), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-a07', name: 'Geo-Tag Validation %', code: 'GEOTAG_VALID', category: 'Asset', description: 'Assets with valid GPS coordinates', formula: stat(96), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-a08', name: 'Photo Proof Validation %', code: 'PHOTO_PROOF', category: 'Asset', description: 'Photos meeting audit criteria', formula: stat(92), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },

      // ==================== 8.7 TRADE MARKETING KPIs ====================
      { id: 'kpi-tm01', name: 'Campaign Execution %', code: 'CAMPAIGN_EXEC', category: 'Trade Marketing', description: 'Campaigns executed per plan', formula: stat(90), unit: 'percentage', direction: 'higher_is_better', applicable_roles: tmRoles },
      { id: 'kpi-tm02', name: 'Promotion Compliance %', code: 'PROMO_COMPLIANCE', category: 'Trade Marketing', description: 'Promotions applied correctly at POS', formula: stat(88), unit: 'percentage', direction: 'higher_is_better', applicable_roles: tmRoles },
      { id: 'kpi-tm03', name: 'Promo Sell-Out %', code: 'PROMO_SELLOUT', category: 'Trade Marketing', description: 'Promotional stock sold through', formula: stat(82), unit: 'percentage', direction: 'higher_is_better', applicable_roles: tmRoles },
      { id: 'kpi-tm04', name: 'Launch Compliance %', code: 'LAUNCH_COMPLIANCE', category: 'Trade Marketing', description: 'New launch activities executed', formula: stat(85), unit: 'percentage', direction: 'higher_is_better', applicable_roles: tmRoles },
      { id: 'kpi-tm05', name: 'Activation Reporting Compliance %', code: 'ACTIVATION_REPORT', category: 'Trade Marketing', description: 'Activation reports submitted on time', formula: stat(93), unit: 'percentage', direction: 'higher_is_better', applicable_roles: tmRoles },
      { id: 'kpi-tm06', name: 'Display Duration Compliance %', code: 'DISPLAY_DURATION', category: 'Trade Marketing', description: 'Display remained for contracted period', formula: stat(87), unit: 'percentage', direction: 'higher_is_better', applicable_roles: tmRoles },

      // ==================== 8.8 INVENTORY & FRESHNESS KPIs ====================
      { id: 'kpi-i01', name: 'FIFO Compliance %', code: 'FIFO_COMPLIANCE', category: 'Inventory', description: 'First-in-first-out stock rotation', formula: stat(94), unit: 'percentage', direction: 'higher_is_better', applicable_roles: allRoles },
      { id: 'kpi-i02', name: 'Near Expiry Clearance %', code: 'NEAR_EXPIRY_CLEAR', category: 'Inventory', description: 'Near-expiry stock cleared on time', formula: stat(88), unit: 'percentage', direction: 'higher_is_better', applicable_roles: allRoles },
      { id: 'kpi-i03', name: 'Warehouse Shrinkage %', code: 'SHRINKAGE', category: 'Inventory', description: 'Unexplained inventory loss', formula: stat(1.5), unit: 'percentage', direction: 'lower_is_better', applicable_roles: mgrRoles },
      { id: 'kpi-i04', name: 'Temperature Compliance %', code: 'TEMP_COMPLIANCE', category: 'Inventory', description: 'Cold-chain temp within limits', formula: stat(98), unit: 'percentage', direction: 'higher_is_better', applicable_roles: deliveryRoles },
      { id: 'kpi-i05', name: 'Cold Chain Compliance %', code: 'COLD_CHAIN', category: 'Inventory', description: 'Unbroken cold chain from DC to outlet', formula: stat(96), unit: 'percentage', direction: 'higher_is_better', applicable_roles: deliveryRoles },
      { id: 'kpi-i06', name: 'Van Stock Hygiene Score', code: 'VAN_STOCK_HYGIENE', category: 'Inventory', description: 'Van cleanliness & stock condition audit', formula: stat(85), unit: 'number', direction: 'higher_is_better', applicable_roles: '["role-van-sales","role-delivery","role-van-driver"]' },

      // ==================== 8.9 BEHAVIORAL & COMPLIANCE KPIs ====================
      { id: 'kpi-b01', name: 'Attendance %', code: 'ATTENDANCE', category: 'Behavioral', description: 'Days present / working days', formula: stat(96), unit: 'percentage', direction: 'higher_is_better', applicable_roles: allRoles },
      { id: 'kpi-b02', name: 'Reporting Timeliness %', code: 'REPORT_TIMELY', category: 'Behavioral', description: 'Reports submitted on time', formula: stat(90), unit: 'percentage', direction: 'higher_is_better', applicable_roles: allRoles },
      { id: 'kpi-b03', name: 'CRM Data Accuracy %', code: 'CRM_ACCURACY', category: 'Behavioral', description: 'Customer data entries accurate on audit', formula: stat(93), unit: 'percentage', direction: 'higher_is_better', applicable_roles: allRoles },
      { id: 'kpi-b04', name: 'Survey Completion %', code: 'SURVEY_COMPLETION', category: 'Behavioral', description: 'Surveys assigned and completed', formula: stat(88), unit: 'percentage', direction: 'higher_is_better', applicable_roles: fieldRoles },
      { id: 'kpi-b05', name: 'Safety Compliance %', code: 'SAFETY_COMPLIANCE', category: 'Behavioral', description: 'Safety procedures followed', formula: stat(98), unit: 'percentage', direction: 'higher_is_better', applicable_roles: allRoles },
      { id: 'kpi-b06', name: 'Policy Compliance %', code: 'POLICY_COMPLIANCE', category: 'Behavioral', description: 'Company policies adhered to', formula: stat(95), unit: 'percentage', direction: 'higher_is_better', applicable_roles: allRoles },

      // ==================== 6.3 DELIVERY DRIVER KPIs ====================
      { id: 'kpi-dv01', name: 'Per Drop Count', code: 'PER_DROP', category: 'Delivery', description: 'Successful drops completed', formula: simple('COUNT_DISTINCT', 'customer_id'), unit: 'number', direction: 'higher_is_better', applicable_roles: deliveryRoles },
      { id: 'kpi-dv02', name: 'Per Invoice Delivered', code: 'INV_DELIVERED', category: 'Delivery', description: 'Invoices successfully delivered', formula: stat(150), unit: 'number', direction: 'higher_is_better', applicable_roles: deliveryRoles },
      { id: 'kpi-dv03', name: 'Per Case Delivered', code: 'CASE_DELIVERED', category: 'Delivery', description: 'Cases successfully delivered', formula: stat(1200), unit: 'number', direction: 'higher_is_better', applicable_roles: deliveryRoles },
      { id: 'kpi-dv04', name: 'Zero Complaint Bonus %', code: 'ZERO_COMPLAINT', category: 'Delivery', description: 'Deliveries with no customer complaints', formula: stat(97), unit: 'percentage', direction: 'higher_is_better', applicable_roles: deliveryRoles },
      { id: 'kpi-dv05', name: 'Damage-Free Delivery %', code: 'DAMAGE_FREE', category: 'Delivery', description: 'Deliveries with no damage reported', formula: stat(98), unit: 'percentage', direction: 'higher_is_better', applicable_roles: deliveryRoles },
      { id: 'kpi-dv06', name: 'Fuel Efficiency Score', code: 'FUEL_EFFICIENCY', category: 'Delivery', description: 'KM per liter vs target', formula: stat(85), unit: 'percentage', direction: 'higher_is_better', applicable_roles: deliveryRoles },
      { id: 'kpi-dv07', name: 'Safe Driving Score', code: 'SAFE_DRIVING', category: 'Delivery', description: 'Telematics safety score', formula: stat(88), unit: 'number', direction: 'higher_is_better', applicable_roles: deliveryRoles },
      { id: 'kpi-dv08', name: 'Route Completion %', code: 'ROUTE_COMPLETION', category: 'Delivery', description: 'Planned route fully completed', formula: stat(95), unit: 'percentage', direction: 'higher_is_better', applicable_roles: deliveryRoles },
    ];

    // Idempotent insert — INSERT OR IGNORE skips existing KPIs
    const stmts = kpis.map(k => ({
      sql: `INSERT OR IGNORE INTO kpi_definitions (id, name, code, category, description, formula, unit, direction, applicable_roles, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      args: [k.id, k.name, k.code, k.category, k.description, k.formula, k.unit, k.direction, k.applicable_roles],
    }));

    // Batch in chunks of 50
    let inserted = 0;
    for (let i = 0; i < stmts.length; i += 50) {
      const res = await db.batch(stmts.slice(i, i + 50));
      inserted += res.filter(r => r.rowsAffected > 0).length;
    }
    if (inserted > 0) {
      console.log(`Extended KPI library: ${inserted} new KPIs added (${kpis.length} total in catalog)`);
    }
  } catch (err) {
    console.log('seedExtendedKpiLibrary skipped:', err.message);
  }
}
