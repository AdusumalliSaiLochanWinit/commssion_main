import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { initDb } from './database.js';
import { createSchema } from './schema.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================
// Yaumi Data Import Script
// Imports real bakery distribution data into Commission DB
// ============================================================

const YAUMI_DB_PATH = join(__dirname, '../../yaumi_data.db');
const BATCH_SIZE = 10000;

// Route → Warehouse mapping (from fact_sales analysis)
const ROUTE_WAREHOUSE = {
  9105: 9470004, 9108: 9470004, 9114: 9470004,
  9115: 9470004, 9126: 9470004, 9142: 9470004,
  9202: 9470006, 9204: 9470006, 9209: 9470006,
  9218: 9470006, 9219: 9470006, 9221: 9470006,
};

const DUBAI_ROUTES = [9105, 9108, 9114, 9115, 9126, 9142];
const ABU_DHABI_ROUTES = [9202, 9204, 9209, 9218, 9219, 9221];

// Channel mapping from sales_class_code
const CHANNEL_MAP = {
  SG: 'GT', MG: 'GT', LG: 'GT', MM: 'GT',
  KS: 'KA', KH: 'KA',
  PS: 'MT', PH: 'MT',
  HO: 'Wholesale',
  EC: 'Online',
};

// Strategic categories (core bakery)
const STRATEGIC_CATEGORIES = ['SB', 'BU'];

// Salary by role
const SALARY = { sr: 6000, ss: 10000, asm: 14000, rsm: 18000, nsm: 25000, kam: 12000 };

function importYaumi() {
  console.log('=== Yaumi Data Import ===\n');

  // Open Yaumi DB read-only
  const yaumi = new Database(YAUMI_DB_PATH, { readonly: true });
  console.log(`Opened Yaumi DB: ${YAUMI_DB_PATH}`);

  // Initialize Commission DB (drops and recreates)
  const commDbPath = join(__dirname, '../../commission.db');
  console.log('Recreating commission database...');

  const db = initDb();
  // Drop all tables and recreate
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  db.exec('PRAGMA foreign_keys = OFF');
  for (const t of tables) {
    db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
  }
  db.exec('PRAGMA foreign_keys = ON');
  createSchema(db);
  console.log('Schema recreated.\n');

  // ==================== HELPER ====================
  function batchInsert(table, rows) {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => '?').join(',');
    const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`);
    const tx = db.transaction((batch) => {
      for (const row of batch) {
        stmt.run(...cols.map(c => row[c] ?? null));
      }
    });
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      tx(rows.slice(i, i + BATCH_SIZE));
    }
  }

  // ==================== ROLES ====================
  console.log('Inserting roles...');
  const roles = [
    { id: 'role-psr', name: 'Pre-Sales Representative', level: 1, description: 'Field sales rep handling pre-sales activities', is_field_role: 1 },
    { id: 'role-sr', name: 'Sales Representative', level: 1, description: 'Primary field sales representative', is_field_role: 1 },
    { id: 'role-de', name: 'Delivery Executive', level: 1, description: 'Handles product delivery and collection', is_field_role: 1 },
    { id: 'role-mer', name: 'Merchandiser', level: 1, description: 'In-store merchandising and display', is_field_role: 1 },
    { id: 'role-ss', name: 'Sales Supervisor', level: 2, description: 'Supervises field sales team', is_field_role: 0 },
    { id: 'role-asm', name: 'Area Sales Manager', level: 3, description: 'Manages area sales operations', is_field_role: 0 },
    { id: 'role-rsm', name: 'Regional Sales Manager', level: 4, description: 'Manages regional sales strategy', is_field_role: 0 },
    { id: 'role-zsm', name: 'Zonal Sales Manager', level: 5, description: 'Oversees zonal performance', is_field_role: 0 },
    { id: 'role-nsm', name: 'National Sales Manager', level: 6, description: 'National sales leadership', is_field_role: 0 },
    { id: 'role-kam', name: 'Key Account Manager', level: 3, description: 'Manages key/modern trade accounts', is_field_role: 0 },
  ];
  batchInsert('roles', roles);

  // ==================== TERRITORIES ====================
  console.log('Inserting territories...');
  const territories = [
    { id: 'terr-nat', name: 'Yaumi UAE', type: 'national', parent_id: null },
    { id: 'terr-dubai', name: 'Dubai Region', type: 'region', parent_id: 'terr-nat' },
    { id: 'terr-abudhabi', name: 'Abu Dhabi Region', type: 'region', parent_id: 'terr-nat' },
  ];
  // Add route territories
  for (const route of DUBAI_ROUTES) {
    territories.push({ id: `terr-${route}`, name: `Route ${route}`, type: 'territory', parent_id: 'terr-dubai' });
  }
  for (const route of ABU_DHABI_ROUTES) {
    territories.push({ id: `terr-${route}`, name: `Route ${route}`, type: 'territory', parent_id: 'terr-abudhabi' });
  }
  batchInsert('territories', territories);

  // ==================== PRODUCTS ====================
  console.log('Inserting products...');
  const yaumiItems = yaumi.prepare('SELECT * FROM dim_item ORDER BY item_code').all();

  // Get new launch items (first appeared after 2025-06-01)
  const newLaunchItems = new Set(
    yaumi.prepare(`
      SELECT item_code FROM fact_sales
      WHERE item_type = 'OrderItem'
      GROUP BY item_code
      HAVING MIN(trx_date) >= '2025-06-01'
    `).all().map(r => r.item_code)
  );

  // Get weighted average prices
  const priceMap = {};
  yaumi.prepare(`
    SELECT item_code,
           SUM(ABS(quantity_pcs) * unit_price) / SUM(ABS(quantity_pcs)) as avg_price
    FROM fact_sales
    WHERE trx_date >= '2025-01-01' AND item_type = 'OrderItem' AND unit_price > 0
    GROUP BY item_code
  `).all().forEach(r => { priceMap[r.item_code] = Math.round(r.avg_price * 100) / 100; });

  const products = yaumiItems.map(item => ({
    id: `prod-${item.item_code}`,
    name: item.item_name,
    sku: item.item_code,
    category: item.category_name || 'OTHERS',
    subcategory: item.category_code || '99',
    unit_price: priceMap[item.item_code] || 1.0,
    is_strategic: STRATEGIC_CATEGORIES.includes(item.category_code) ? 1 : 0,
    is_new_launch: newLaunchItems.has(item.item_code) ? 1 : 0,
    tags: '[]',
  }));
  batchInsert('products', products);
  console.log(`  ${products.length} products inserted`);

  // ==================== EMPLOYEES ====================
  console.log('Inserting employees...');

  // Get active salesmen (have transactions in last 14 months)
  const activeSalesmen = yaumi.prepare(`
    SELECT DISTINCT s.salesman_code, s.salesman_name
    FROM dim_salesman s
    JOIN fact_sales f ON s.salesman_code = f.salesman_code
    WHERE f.trx_date >= '2025-01-01' AND f.item_type = 'OrderItem'
    ORDER BY s.salesman_code
  `).all();

  // Get primary route per salesman
  const salesmanRoutes = {};
  yaumi.prepare(`
    SELECT salesman_code, route_code, COUNT(*) as cnt
    FROM fact_sales
    WHERE trx_date >= '2025-01-01' AND item_type = 'OrderItem'
    GROUP BY salesman_code, route_code
    ORDER BY salesman_code, cnt DESC
  `).all().forEach(r => {
    if (!salesmanRoutes[r.salesman_code]) {
      salesmanRoutes[r.salesman_code] = r.route_code;
    }
  });

  // Get earliest transaction per salesman (for hire date)
  const hireDates = {};
  yaumi.prepare('SELECT salesman_code, MIN(trx_date) as first_trx FROM fact_sales GROUP BY salesman_code').all()
    .forEach(r => { hireDates[r.salesman_code] = r.first_trx.substring(0, 10); });

  // Assign salesmen to route territories
  const routeSalesmen = {}; // route -> [salesman_codes]
  for (const s of activeSalesmen) {
    const route = salesmanRoutes[s.salesman_code];
    if (route) {
      if (!routeSalesmen[route]) routeSalesmen[route] = [];
      routeSalesmen[route].push(s.salesman_code);
    }
  }

  // Build fabricated management hierarchy
  // NSM → 2 RSMs → 2 ASMs → 6 Supervisors (1 per 2 routes)
  const employees = [];

  // NSM
  employees.push({
    id: 'emp-nsm-1',
    name: 'Ahmad Al Rashid',
    email: 'ahmad.rashid@yaumi.ae',
    role_id: 'role-nsm',
    territory_id: 'terr-nat',
    reports_to: null,
    base_salary: SALARY.nsm,
    hire_date: '2018-01-01',
    is_active: 1,
  });

  // RSMs
  employees.push({
    id: 'emp-rsm-dubai',
    name: 'Omar Khalil',
    email: 'omar.khalil@yaumi.ae',
    role_id: 'role-rsm',
    territory_id: 'terr-dubai',
    reports_to: 'emp-nsm-1',
    base_salary: SALARY.rsm,
    hire_date: '2019-03-01',
    is_active: 1,
  });
  employees.push({
    id: 'emp-rsm-ad',
    name: 'Saeed Al Mansoori',
    email: 'saeed.mansoori@yaumi.ae',
    role_id: 'role-rsm',
    territory_id: 'terr-abudhabi',
    reports_to: 'emp-nsm-1',
    base_salary: SALARY.rsm,
    hire_date: '2019-06-01',
    is_active: 1,
  });

  // ASMs (1 per region)
  employees.push({
    id: 'emp-asm-dubai',
    name: 'Faisal Hassan',
    email: 'faisal.hassan@yaumi.ae',
    role_id: 'role-asm',
    territory_id: 'terr-dubai',
    reports_to: 'emp-rsm-dubai',
    base_salary: SALARY.asm,
    hire_date: '2020-01-01',
    is_active: 1,
  });
  employees.push({
    id: 'emp-asm-ad',
    name: 'Tariq Bin Zayed',
    email: 'tariq.zayed@yaumi.ae',
    role_id: 'role-asm',
    territory_id: 'terr-abudhabi',
    reports_to: 'emp-rsm-ad',
    base_salary: SALARY.asm,
    hire_date: '2020-04-01',
    is_active: 1,
  });

  // Supervisors: 1 per 2 routes
  const dubaiRoutePairs = [[9105, 9108], [9114, 9115], [9126, 9142]];
  const adRoutePairs = [[9202, 9204], [9209, 9218], [9219, 9221]];
  const supervisorNames = [
    { name: 'Khalid Ibrahim', email: 'khalid.ibrahim@yaumi.ae' },
    { name: 'Yousuf Ali', email: 'yousuf.ali@yaumi.ae' },
    { name: 'Majid Noor', email: 'majid.noor@yaumi.ae' },
    { name: 'Rashid Hamdan', email: 'rashid.hamdan@yaumi.ae' },
    { name: 'Nasser Al Dhaheri', email: 'nasser.dhaheri@yaumi.ae' },
    { name: 'Sultan Mohammed', email: 'sultan.mohammed@yaumi.ae' },
  ];

  const supervisorMap = {}; // route -> supervisor emp id
  let ssIdx = 0;
  for (const pair of dubaiRoutePairs) {
    const ssId = `emp-ss-${pair[0]}`;
    const ss = supervisorNames[ssIdx++];
    employees.push({
      id: ssId,
      name: ss.name,
      email: ss.email,
      role_id: 'role-ss',
      territory_id: `terr-${pair[0]}`,
      reports_to: 'emp-asm-dubai',
      base_salary: SALARY.ss,
      hire_date: '2021-01-01',
      is_active: 1,
    });
    for (const r of pair) supervisorMap[r] = ssId;
  }
  for (const pair of adRoutePairs) {
    const ssId = `emp-ss-${pair[0]}`;
    const ss = supervisorNames[ssIdx++];
    employees.push({
      id: ssId,
      name: ss.name,
      email: ss.email,
      role_id: 'role-ss',
      territory_id: `terr-${pair[0]}`,
      reports_to: 'emp-asm-ad',
      base_salary: SALARY.ss,
      hire_date: '2021-01-01',
      is_active: 1,
    });
    for (const r of pair) supervisorMap[r] = ssId;
  }

  // KAM
  employees.push({
    id: 'emp-kam-1',
    name: 'Layla Mahmoud',
    email: 'layla.mahmoud@yaumi.ae',
    role_id: 'role-kam',
    territory_id: 'terr-nat',
    reports_to: 'emp-nsm-1',
    base_salary: SALARY.kam,
    hire_date: '2021-06-01',
    is_active: 1,
  });

  // Sales Representatives (from real Yaumi salesmen)
  for (const s of activeSalesmen) {
    const route = salesmanRoutes[s.salesman_code];
    const terrId = route ? `terr-${route}` : 'terr-dubai';
    const reportsTo = route ? (supervisorMap[route] || 'emp-asm-dubai') : 'emp-asm-dubai';

    // Title-case the name
    const nameParts = s.salesman_name.split(' ').map(p =>
      p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
    );
    const name = nameParts.join(' ');

    employees.push({
      id: `emp-${s.salesman_code}`,
      name: name,
      email: `${s.salesman_code}@yaumi.ae`,
      role_id: 'role-sr',
      territory_id: terrId,
      reports_to: reportsTo,
      base_salary: SALARY.sr,
      hire_date: hireDates[s.salesman_code] || '2023-01-01',
      is_active: 1,
    });
  }

  batchInsert('employees', employees);
  console.log(`  ${employees.length} employees inserted (${activeSalesmen.length} salesmen + ${employees.length - activeSalesmen.length} management)`);

  // ==================== CUSTOMERS ====================
  console.log('Inserting customers...');

  // Get active customers with their primary route
  const customerRoutes = {};
  yaumi.prepare(`
    SELECT customer_code, route_code, COUNT(*) as cnt
    FROM fact_sales
    WHERE trx_date >= '2025-01-01' AND item_type = 'OrderItem'
    GROUP BY customer_code, route_code
    ORDER BY customer_code, cnt DESC
  `).all().forEach(r => {
    if (!customerRoutes[r.customer_code]) {
      customerRoutes[r.customer_code] = r.route_code;
    }
  });

  const activeCustomerCodes = new Set(Object.keys(customerRoutes).map(Number));
  const yaumiCustomers = yaumi.prepare('SELECT * FROM dim_customer ORDER BY customer_code').all()
    .filter(c => activeCustomerCodes.has(c.customer_code));

  const customers = yaumiCustomers.map(c => {
    const channel = CHANNEL_MAP[c.sales_class_code] || 'GT';
    const route = customerRoutes[c.customer_code];
    const terrId = route ? `terr-${route}` : 'terr-dubai';
    return {
      id: `cust-${c.customer_code}`,
      name: c.customer_name || `Customer ${c.customer_code}`,
      channel,
      territory_id: terrId,
      credit_limit: channel === 'KA' ? 500000 : channel === 'MT' ? 200000 : channel === 'Wholesale' ? 300000 : 50000,
      tags: JSON.stringify([c.sales_class_code || 'GT', c.customer_group_code || ''].filter(Boolean)),
    };
  });
  batchInsert('customers', customers);
  console.log(`  ${customers.length} customers inserted`);

  // ==================== KPI DEFINITIONS ====================
  console.log('Inserting KPI definitions...');
  const kpis = [
    { id: 'kpi-01', name: 'Total Revenue', code: 'TOTAL_REVENUE', category: 'Revenue', description: 'Total sales revenue in the period', formula: 'SUM(transactions.amount) WHERE type=sale', unit: 'currency', direction: 'higher_is_better', applicable_roles: '["role-sr","role-psr","role-kam"]', is_active: 1 },
    { id: 'kpi-02', name: 'Revenue Growth %', code: 'REVENUE_GROWTH', category: 'Revenue', description: 'Revenue growth vs same period last year', formula: '((current_revenue - prev_revenue) / prev_revenue) * 100', unit: 'percentage', direction: 'higher_is_better', applicable_roles: '["role-sr","role-asm","role-rsm"]', is_active: 1 },
    { id: 'kpi-03', name: 'Units Sold', code: 'UNITS_SOLD', category: 'Volume', description: 'Total units sold in the period', formula: 'SUM(transactions.quantity) WHERE type=sale', unit: 'number', direction: 'higher_is_better', applicable_roles: '["role-sr","role-psr","role-de"]', is_active: 1 },
    { id: 'kpi-04', name: 'Outlet Coverage', code: 'OUTLET_COVERAGE', category: 'Distribution', description: 'Number of unique outlets with sales', formula: 'COUNT(DISTINCT customer_id) WHERE type=sale', unit: 'number', direction: 'higher_is_better', applicable_roles: '["role-sr","role-psr"]', is_active: 1 },
    { id: 'kpi-05', name: 'Lines Per Call', code: 'LINES_PER_CALL', category: 'Distribution', description: 'Average product lines sold per customer visit', formula: 'COUNT(DISTINCT product_id) / COUNT(DISTINCT customer_id)', unit: 'number', direction: 'higher_is_better', applicable_roles: '["role-sr","role-psr"]', is_active: 1 },
    { id: 'kpi-06', name: 'Collection %', code: 'COLLECTION_PERCENT', category: 'Collection', description: 'Collection amount as % of sales', formula: '(SUM(amount WHERE type=collection) / SUM(amount WHERE type=sale)) * 100', unit: 'percentage', direction: 'higher_is_better', applicable_roles: '["role-sr","role-de","role-kam"]', is_active: 1 },
    { id: 'kpi-07', name: 'Return %', code: 'RETURN_PERCENT', category: 'Returns', description: 'Return amount as % of sales', formula: '(SUM(amount WHERE type=return) / SUM(amount WHERE type=sale)) * 100', unit: 'percentage', direction: 'lower_is_better', applicable_roles: '["role-sr","role-de","role-kam"]', is_active: 1 },
    { id: 'kpi-08', name: 'Strategic SKU Revenue', code: 'STRATEGIC_SKU_REV', category: 'Product Mix', description: 'Revenue from strategic SKUs (Sliced Bread & Buns)', formula: 'SUM(amount) WHERE product.is_strategic=1 AND type=sale', unit: 'currency', direction: 'higher_is_better', applicable_roles: '["role-sr","role-kam"]', is_active: 1 },
    { id: 'kpi-09', name: 'New Launch Sales', code: 'NEW_LAUNCH_SALES', category: 'Product Mix', description: 'Revenue from new launch products', formula: 'SUM(amount) WHERE product.is_new_launch=1 AND type=sale', unit: 'currency', direction: 'higher_is_better', applicable_roles: '["role-sr","role-psr"]', is_active: 1 },
    { id: 'kpi-10', name: 'New Customer Acquisition', code: 'NEW_CUSTOMERS', category: 'Customer', description: 'Number of new customers added', formula: 'COUNT(DISTINCT customer_id) WHERE first_transaction_in_period', unit: 'number', direction: 'higher_is_better', applicable_roles: '["role-sr","role-psr"]', is_active: 1 },
    { id: 'kpi-11', name: 'Team Revenue', code: 'TEAM_REVENUE', category: 'Team', description: 'Total revenue of direct reports', formula: 'SUM(direct_reports.total_revenue)', unit: 'currency', direction: 'higher_is_better', applicable_roles: '["role-ss","role-asm","role-rsm","role-zsm","role-nsm"]', is_active: 1 },
    { id: 'kpi-12', name: 'Team Target Achievement', code: 'TEAM_TARGET_ACH', category: 'Team', description: 'Average target achievement % of team', formula: 'AVG(direct_reports.achievement_percent)', unit: 'percentage', direction: 'higher_is_better', applicable_roles: '["role-ss","role-asm","role-rsm"]', is_active: 1 },
    { id: 'kpi-13', name: 'Revenue Per Outlet', code: 'REV_PER_OUTLET', category: 'Efficiency', description: 'Average revenue per active outlet', formula: 'SUM(amount WHERE type=sale) / COUNT(DISTINCT customer_id)', unit: 'currency', direction: 'higher_is_better', applicable_roles: '["role-sr","role-psr"]', is_active: 1 },
    { id: 'kpi-14', name: 'On-Time Delivery %', code: 'OTD_PERCENT', category: 'Compliance', description: 'Orders delivered on scheduled date', formula: 'COUNT(on_time_deliveries) / COUNT(total_deliveries) * 100', unit: 'percentage', direction: 'higher_is_better', applicable_roles: '["role-de","role-ss","role-asm"]', is_active: 1 },
    { id: 'kpi-15', name: 'Gross Margin', code: 'GROSS_MARGIN', category: 'Profitability', description: 'Gross profit margin percentage', formula: '((revenue - cogs) / revenue) * 100', unit: 'percentage', direction: 'higher_is_better', applicable_roles: '["role-asm","role-rsm","role-nsm","role-kam"]', is_active: 1 },
  ];
  batchInsert('kpi_definitions', kpis);

  // ==================== TRANSACTIONS ====================
  console.log('Importing transactions (this may take a minute)...');

  // Import sales and returns from fact_sales (last 14 months, OrderItem only)
  const salesRows = yaumi.prepare(`
    SELECT trx_date, item_type, route_code, warehouse_code, customer_code,
           trx_type, item_code, quantity_pcs, unit_price,
           total_discount_amount, total_tax_amount, salesman_code
    FROM fact_sales
    WHERE trx_date >= '2025-01-01'
      AND item_type = 'OrderItem'
    ORDER BY trx_date
  `).all();

  console.log(`  Found ${salesRows.length} Yaumi transactions to import`);

  // Build set of valid employee/customer/product IDs
  const validEmployees = new Set(employees.map(e => e.id));
  const validCustomers = new Set(customers.map(c => c.id));
  const validProducts = new Set(products.map(p => p.id));

  let txnBatch = [];
  let txnCount = 0;
  let skippedCount = 0;

  const txnStmt = db.prepare(`
    INSERT INTO transactions (id, employee_id, customer_id, product_id, transaction_type, quantity, amount, transaction_date, period, territory_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const txnInsertBatch = db.transaction((batch) => {
    for (const t of batch) {
      txnStmt.run(t.id, t.employee_id, t.customer_id, t.product_id, t.transaction_type, t.quantity, t.amount, t.transaction_date, t.period, t.territory_id);
    }
  });

  for (const row of salesRows) {
    const empId = `emp-${row.salesman_code}`;
    const custId = `cust-${row.customer_code}`;
    const prodId = `prod-${row.item_code}`;

    if (!validEmployees.has(empId) || !validCustomers.has(custId) || !validProducts.has(prodId)) {
      skippedCount++;
      continue;
    }

    const trxType = row.trx_type === 'SalesInvoice' ? 'sale' : 'return';
    const qty = Math.abs(row.quantity_pcs);
    const rawAmount = Math.abs(row.quantity_pcs * row.unit_price - row.total_discount_amount + row.total_tax_amount);
    const amount = Math.round(rawAmount * 100) / 100;
    const trxDate = row.trx_date.substring(0, 10);
    const period = trxDate.substring(0, 7);
    const terrId = row.route_code ? `terr-${row.route_code}` : 'terr-dubai';

    txnBatch.push({
      id: uuid(),
      employee_id: empId,
      customer_id: custId,
      product_id: prodId,
      transaction_type: trxType,
      quantity: qty,
      amount,
      transaction_date: trxDate,
      period,
      territory_id: terrId,
    });

    if (txnBatch.length >= BATCH_SIZE) {
      txnInsertBatch(txnBatch);
      txnCount += txnBatch.length;
      process.stdout.write(`\r  Inserted ${txnCount} transactions...`);
      txnBatch = [];
    }
  }
  if (txnBatch.length) {
    txnInsertBatch(txnBatch);
    txnCount += txnBatch.length;
  }
  console.log(`\n  ${txnCount} sale/return transactions inserted (${skippedCount} skipped - missing refs)`);

  // ==================== COLLECTIONS (synthetic) ====================
  console.log('Generating collection transactions...');

  // For each salesman-month, generate collections = 85-95% of sales
  const salesBySalesmanMonth = db.prepare(`
    SELECT employee_id, period, SUM(amount) as total_sales, COUNT(DISTINCT customer_id) as cust_count
    FROM transactions
    WHERE transaction_type = 'sale'
    GROUP BY employee_id, period
  `).all();

  // Get visit data for timing
  const visitData = {};
  yaumi.prepare(`
    SELECT user_code, substr(visit_date, 1, 7) as month, COUNT(*) as visits
    FROM fact_customer_visits
    WHERE visit_date >= '2025-01-01'
    GROUP BY user_code, month
  `).all().forEach(r => {
    visitData[`${r.user_code}-${r.month}`] = r.visits;
  });

  // Get customer list per employee
  const empCustomers = {};
  db.prepare(`
    SELECT DISTINCT employee_id, customer_id
    FROM transactions
    WHERE transaction_type = 'sale'
  `).all().forEach(r => {
    if (!empCustomers[r.employee_id]) empCustomers[r.employee_id] = [];
    empCustomers[r.employee_id].push(r.customer_id);
  });

  // Get employee territory
  const empTerritory = {};
  for (const e of employees) {
    empTerritory[e.id] = e.territory_id;
  }

  let collBatch = [];
  let collCount = 0;

  // Use a seeded pseudo-random for deterministic results
  let seed = 42;
  function pseudoRandom() {
    seed = (seed * 16807 + 0) % 2147483647;
    return seed / 2147483647;
  }

  for (const row of salesBySalesmanMonth) {
    const salesmanCode = row.employee_id.replace('emp-', '');
    const visitKey = `${salesmanCode}-${row.period}`;
    const visits = visitData[visitKey] || 20;

    // Collection rate 85-95%
    const collRate = 0.85 + pseudoRandom() * 0.10;
    const totalCollection = row.total_sales * collRate;
    const custList = empCustomers[row.employee_id] || [];
    if (!custList.length) continue;

    // Spread across ~visits/3 collection entries
    const collEntries = Math.max(3, Math.min(Math.floor(visits / 3), 30));
    const perEntry = totalCollection / collEntries;

    const daysInMonth = row.period.endsWith('-02') ? 28 : ['-04', '-06', '-09', '-11'].some(m => row.period.endsWith(m)) ? 30 : 31;
    const firstProd = validProducts.values().next().value;

    for (let i = 0; i < collEntries; i++) {
      const day = Math.max(1, Math.min(daysInMonth, Math.floor(5 + pseudoRandom() * (daysInMonth - 5))));
      const dayStr = String(day).padStart(2, '0');
      const cust = custList[Math.floor(pseudoRandom() * custList.length)];
      const amt = Math.round(perEntry * (0.7 + pseudoRandom() * 0.6) * 100) / 100;

      collBatch.push({
        id: uuid(),
        employee_id: row.employee_id,
        customer_id: cust,
        product_id: firstProd,
        transaction_type: 'collection',
        quantity: 0,
        amount: amt,
        transaction_date: `${row.period}-${dayStr}`,
        period: row.period,
        territory_id: empTerritory[row.employee_id] || 'terr-dubai',
      });

      if (collBatch.length >= BATCH_SIZE) {
        txnInsertBatch(collBatch);
        collCount += collBatch.length;
        collBatch = [];
      }
    }
  }
  if (collBatch.length) {
    txnInsertBatch(collBatch);
    collCount += collBatch.length;
  }
  console.log(`  ${collCount} collection transactions generated`);

  // ==================== COMMISSION PLANS ====================
  console.log('Creating commission plans...');

  // Plan 1: Yaumi Field Sales Monthly Incentive
  const plan1 = {
    id: 'plan-01',
    name: 'Yaumi Field Sales Monthly Incentive',
    description: 'Monthly commission plan for field sales representatives based on revenue, units, collection, coverage, and returns KPIs',
    status: 'active',
    plan_type: 'monthly',
    effective_from: '2025-01-01',
    effective_to: '2026-12-31',
    base_payout: 2000,
    created_by: 'emp-nsm-1',
  };

  // Plan 2: Yaumi Supervisor Quarterly Bonus
  const plan2 = {
    id: 'plan-02',
    name: 'Yaumi Supervisor Quarterly Bonus',
    description: 'Quarterly bonus plan for supervisors and ASMs based on team performance metrics',
    status: 'active',
    plan_type: 'quarterly',
    effective_from: '2025-01-01',
    effective_to: '2026-12-31',
    base_payout: 5000,
    created_by: 'emp-nsm-1',
  };

  // Plan 3: Yaumi Key Account Incentive
  const plan3 = {
    id: 'plan-03',
    name: 'Yaumi Key Account Incentive',
    description: 'Monthly incentive plan for Key Account Managers focusing on strategic SKUs and collections',
    status: 'active',
    plan_type: 'monthly',
    effective_from: '2025-01-01',
    effective_to: '2026-12-31',
    base_payout: 3000,
    created_by: 'emp-nsm-1',
  };

  batchInsert('commission_plans', [plan1, plan2, plan3]);

  // Plan Roles
  batchInsert('plan_roles', [
    { id: uuid(), plan_id: 'plan-01', role_id: 'role-sr' },
    { id: uuid(), plan_id: 'plan-02', role_id: 'role-ss' },
    { id: uuid(), plan_id: 'plan-02', role_id: 'role-asm' },
    { id: uuid(), plan_id: 'plan-03', role_id: 'role-kam' },
  ]);

  // Plan Territories (all territories)
  const allTerritoryIds = territories.map(t => t.id);
  for (const planId of ['plan-01', 'plan-02', 'plan-03']) {
    batchInsert('plan_territories', allTerritoryIds.map(tid => ({
      id: uuid(), plan_id: planId, territory_id: tid,
    })));
  }

  // ==================== SLAB SETS ====================
  console.log('Creating slab configurations...');

  const slabSets = [
    { id: 'slab-01', name: 'Revenue Step Slab', type: 'step', plan_id: 'plan-01', kpi_id: 'kpi-01' },
    { id: 'slab-02', name: 'Units Progressive Slab', type: 'progressive', plan_id: 'plan-01', kpi_id: 'kpi-03' },
    { id: 'slab-03', name: 'Collection Accelerator', type: 'accelerator', plan_id: 'plan-01', kpi_id: 'kpi-06' },
    { id: 'slab-04', name: 'Team Revenue Slab', type: 'step', plan_id: 'plan-02', kpi_id: 'kpi-11' },
    { id: 'slab-05', name: 'KA Revenue Step Slab', type: 'step', plan_id: 'plan-03', kpi_id: 'kpi-01' },
  ];
  batchInsert('slab_sets', slabSets);

  const slabTiers = [
    // Revenue Step Slab (plan-01)
    { id: uuid(), slab_set_id: 'slab-01', tier_order: 1, min_percent: 0, max_percent: 70, rate: 0, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-01', tier_order: 2, min_percent: 70, max_percent: 85, rate: 3, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-01', tier_order: 3, min_percent: 85, max_percent: 100, rate: 5, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-01', tier_order: 4, min_percent: 100, max_percent: 120, rate: 8, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-01', tier_order: 5, min_percent: 120, max_percent: null, rate: 12, rate_type: 'percentage' },
    // Units Progressive Slab (plan-01)
    { id: uuid(), slab_set_id: 'slab-02', tier_order: 1, min_percent: 0, max_percent: 80, rate: 0.02, rate_type: 'per_unit' },
    { id: uuid(), slab_set_id: 'slab-02', tier_order: 2, min_percent: 80, max_percent: 100, rate: 0.04, rate_type: 'per_unit' },
    { id: uuid(), slab_set_id: 'slab-02', tier_order: 3, min_percent: 100, max_percent: 130, rate: 0.07, rate_type: 'per_unit' },
    { id: uuid(), slab_set_id: 'slab-02', tier_order: 4, min_percent: 130, max_percent: null, rate: 0.10, rate_type: 'per_unit' },
    // Collection Accelerator (plan-01)
    { id: uuid(), slab_set_id: 'slab-03', tier_order: 1, min_percent: 0, max_percent: 100, rate: 5, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-03', tier_order: 2, min_percent: 100, max_percent: null, rate: 10, rate_type: 'percentage' },
    // Team Revenue Slab (plan-02)
    { id: uuid(), slab_set_id: 'slab-04', tier_order: 1, min_percent: 0, max_percent: 80, rate: 0, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-04', tier_order: 2, min_percent: 80, max_percent: 100, rate: 4, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-04', tier_order: 3, min_percent: 100, max_percent: null, rate: 7, rate_type: 'percentage' },
    // KA Revenue Step Slab (plan-03)
    { id: uuid(), slab_set_id: 'slab-05', tier_order: 1, min_percent: 0, max_percent: 70, rate: 0, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-05', tier_order: 2, min_percent: 70, max_percent: 100, rate: 4, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-05', tier_order: 3, min_percent: 100, max_percent: null, rate: 8, rate_type: 'percentage' },
  ];
  batchInsert('slab_tiers', slabTiers);

  // Plan KPIs
  const planKpis = [
    // Plan 1: Field Sales
    { id: uuid(), plan_id: 'plan-01', kpi_id: 'kpi-01', weight: 40, target_value: 70000, slab_set_id: 'slab-01' },
    { id: uuid(), plan_id: 'plan-01', kpi_id: 'kpi-03', weight: 20, target_value: 4500, slab_set_id: 'slab-02' },
    { id: uuid(), plan_id: 'plan-01', kpi_id: 'kpi-06', weight: 15, target_value: 90, slab_set_id: 'slab-03' },
    { id: uuid(), plan_id: 'plan-01', kpi_id: 'kpi-04', weight: 15, target_value: 25, slab_set_id: null },
    { id: uuid(), plan_id: 'plan-01', kpi_id: 'kpi-07', weight: 10, target_value: 8, slab_set_id: null },
    // Plan 2: Supervisor
    { id: uuid(), plan_id: 'plan-02', kpi_id: 'kpi-11', weight: 50, target_value: 500000, slab_set_id: 'slab-04' },
    { id: uuid(), plan_id: 'plan-02', kpi_id: 'kpi-12', weight: 30, target_value: 90, slab_set_id: null },
    { id: uuid(), plan_id: 'plan-02', kpi_id: 'kpi-14', weight: 20, target_value: 90, slab_set_id: null },
    // Plan 3: KAM
    { id: uuid(), plan_id: 'plan-03', kpi_id: 'kpi-01', weight: 35, target_value: 200000, slab_set_id: 'slab-05' },
    { id: uuid(), plan_id: 'plan-03', kpi_id: 'kpi-08', weight: 25, target_value: 80000, slab_set_id: null },
    { id: uuid(), plan_id: 'plan-03', kpi_id: 'kpi-06', weight: 20, target_value: 90, slab_set_id: null },
    { id: uuid(), plan_id: 'plan-03', kpi_id: 'kpi-07', weight: 20, target_value: 8, slab_set_id: null },
  ];
  batchInsert('plan_kpis', planKpis);

  // ==================== RULE SETS ====================
  console.log('Creating rule sets...');

  batchInsert('rule_sets', [
    { id: 'rs-01', plan_id: 'plan-01', name: 'Bakery Product Rules', description: 'Include all bakery product categories' },
    { id: 'rs-02', plan_id: 'plan-01', name: 'Channel Rules', description: 'GT and MT channel filtering' },
    { id: 'rs-03', plan_id: 'plan-03', name: 'KA Channel Rules', description: 'Key Account channel filtering' },
  ]);

  batchInsert('rules', [
    { id: uuid(), rule_set_id: 'rs-01', dimension: 'product_category', rule_type: 'include', match_type: 'category', match_values: '["SLICED BREAD","BUNS","ROLLS","CUP CAKES","POUND CAKES","PUFFS","SLICED CAKES","ARABIC BREAD","TORTILLA","Fresh Tortilla","OTHERS"]', priority: 1 },
    { id: uuid(), rule_set_id: 'rs-02', dimension: 'customer_channel', rule_type: 'include', match_type: 'category', match_values: '["GT","MT"]', priority: 1 },
    { id: uuid(), rule_set_id: 'rs-03', dimension: 'customer_channel', rule_type: 'include', match_type: 'category', match_values: '["KA","MT"]', priority: 1 },
  ]);

  // ==================== ELIGIBILITY RULES ====================
  batchInsert('eligibility_rules', [
    { id: uuid(), plan_id: 'plan-01', metric: 'min_sales', operator: '>=', threshold: 20000, action: 'zero_payout', reduction_percent: 0, is_active: 1 },
    { id: uuid(), plan_id: 'plan-01', metric: 'min_collection_percent', operator: '>=', threshold: 60, action: 'reduce_percent', reduction_percent: 50, is_active: 1 },
    { id: uuid(), plan_id: 'plan-01', metric: 'max_return_percent', operator: '<=', threshold: 15, action: 'warning_only', reduction_percent: 0, is_active: 1 },
    { id: uuid(), plan_id: 'plan-03', metric: 'min_sales', operator: '>=', threshold: 50000, action: 'zero_payout', reduction_percent: 0, is_active: 1 },
  ]);

  // ==================== MULTIPLIER RULES ====================
  batchInsert('multiplier_rules', [
    { id: uuid(), plan_id: 'plan-01', name: 'Revenue Growth Bonus', type: 'growth', condition_metric: 'revenue_growth_percent', condition_operator: '>=', condition_value: 15, multiplier_value: 1.15, stacking_mode: 'multiplicative', is_active: 1 },
    { id: uuid(), plan_id: 'plan-01', name: 'Strategic SKU Push', type: 'strategic_sku', condition_metric: 'strategic_sku_percent', condition_operator: '>=', condition_value: 40, multiplier_value: 1.10, stacking_mode: 'multiplicative', is_active: 1 },
    { id: uuid(), plan_id: 'plan-03', name: 'Collection Speed Bonus', type: 'collection_speed', condition_metric: 'collection_percent', condition_operator: '>=', condition_value: 95, multiplier_value: 1.10, stacking_mode: 'multiplicative', is_active: 1 },
  ]);

  // ==================== PENALTY RULES ====================
  batchInsert('penalty_rules', [
    { id: uuid(), plan_id: 'plan-01', name: 'High Returns Penalty', trigger_metric: 'return_percent', trigger_operator: '>', trigger_value: 12, penalty_type: 'percentage', penalty_value: 15, is_active: 1 },
    { id: uuid(), plan_id: 'plan-03', name: 'KA High Returns Penalty', trigger_metric: 'return_percent', trigger_operator: '>', trigger_value: 10, penalty_type: 'percentage', penalty_value: 20, is_active: 1 },
  ]);

  // ==================== CAPPING RULES ====================
  batchInsert('capping_rules', [
    { id: uuid(), plan_id: 'plan-01', cap_type: 'max_per_plan', cap_value: 8000, is_active: 1 },
    { id: uuid(), plan_id: 'plan-01', cap_type: 'percent_of_salary', cap_value: 150, is_active: 1 },
    { id: uuid(), plan_id: 'plan-02', cap_type: 'max_per_plan', cap_value: 15000, is_active: 1 },
    { id: uuid(), plan_id: 'plan-03', cap_type: 'max_per_plan', cap_value: 10000, is_active: 1 },
    { id: uuid(), plan_id: 'plan-03', cap_type: 'percent_of_salary', cap_value: 120, is_active: 1 },
  ]);

  // ==================== AUDIT TRAIL ====================
  batchInsert('audit_trail', [
    { id: uuid(), entity_type: 'plan', entity_id: 'plan-01', action: 'created', changes: JSON.stringify({ name: plan1.name, status: 'draft' }), performed_by: 'emp-nsm-1' },
    { id: uuid(), entity_type: 'plan', entity_id: 'plan-01', action: 'activated', changes: JSON.stringify({ status: { from: 'draft', to: 'active' } }), performed_by: 'emp-nsm-1' },
    { id: uuid(), entity_type: 'plan', entity_id: 'plan-02', action: 'created', changes: JSON.stringify({ name: plan2.name, status: 'draft' }), performed_by: 'emp-nsm-1' },
    { id: uuid(), entity_type: 'plan', entity_id: 'plan-02', action: 'activated', changes: JSON.stringify({ status: { from: 'draft', to: 'active' } }), performed_by: 'emp-nsm-1' },
    { id: uuid(), entity_type: 'plan', entity_id: 'plan-03', action: 'created', changes: JSON.stringify({ name: plan3.name, status: 'draft' }), performed_by: 'emp-nsm-1' },
    { id: uuid(), entity_type: 'plan', entity_id: 'plan-03', action: 'activated', changes: JSON.stringify({ status: { from: 'draft', to: 'active' } }), performed_by: 'emp-nsm-1' },
  ]);

  // ==================== SUMMARY ====================
  const txnTotal = db.prepare('SELECT COUNT(*) as c FROM transactions').get().c;
  const salesTotal = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE transaction_type = 'sale'").get().c;
  const returnTotal = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE transaction_type = 'return'").get().c;
  const collTotal = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE transaction_type = 'collection'").get().c;

  console.log('\n=== Import Summary ===');
  console.log(`  Roles:        ${roles.length}`);
  console.log(`  Territories:  ${territories.length}`);
  console.log(`  Products:     ${products.length}`);
  console.log(`  Customers:    ${customers.length}`);
  console.log(`  Employees:    ${employees.length} (${activeSalesmen.length} salesmen + ${employees.length - activeSalesmen.length} management)`);
  console.log(`  KPIs:         ${kpis.length}`);
  console.log(`  Plans:        3`);
  console.log(`  Transactions: ${txnTotal} total`);
  console.log(`    - Sales:       ${salesTotal}`);
  console.log(`    - Returns:     ${returnTotal}`);
  console.log(`    - Collections: ${collTotal}`);
  console.log('\nImport complete!');

  yaumi.close();
}

importYaumi();
