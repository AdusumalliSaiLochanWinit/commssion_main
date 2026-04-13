import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const YAUMI_DB_PATH = path.resolve(__dirname, '..', '..', '..', '..', 'YuamiGrowthIQ', 'yaumi_data.db');

/**
 * Sync reference data from YOMI (yaumi_data.db) into the Commission DB.
 * Uses better-sqlite3 to read YOMI (local file) and the async db wrapper to write.
 */
export async function syncFromYaumi(db) {
  let Database;
  try {
    Database = (await import('better-sqlite3')).default;
  } catch {
    console.log('better-sqlite3 not available, skipping YOMI sync');
    return;
  }

  let yaumiDb;
  try {
    yaumiDb = new Database(YAUMI_DB_PATH, { readonly: true });
  } catch (err) {
    console.warn(`YOMI DB not found at ${YAUMI_DB_PATH}, skipping sync. (${err.message})`);
    return;
  }

  console.log('Syncing reference data from YOMI database...');

  const upsert = async (table, rows, keyCol = 'id') => {
    if (rows.length === 0) return;
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => '?').join(',');
    const setClauses = cols.filter(c => c !== keyCol).map(c => `${c} = excluded.${c}`).join(', ');
    const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})
       ON CONFLICT(${keyCol}) DO UPDATE SET ${setClauses}`;
    const stmts = rows.map(item => ({
      sql,
      args: cols.map(c => item[c]),
    }));
    // Batch in chunks of 100 to avoid too-large requests
    for (let i = 0; i < stmts.length; i += 100) {
      await db.batch(stmts.slice(i, i + 100));
    }
  };

  // ==================== ROLES ====================
  const existingRoles = await db.prepare('SELECT COUNT(*) as c FROM roles').get();
  if (existingRoles.c === 0) {
    const roles = [
      { id: 'role-salesman', name: 'Salesman', level: 1, description: 'Field salesman handling route-based sales and delivery', is_field_role: 1 },
      { id: 'role-van-driver', name: 'Van Sales Driver', level: 1, description: 'Driver who sells directly from the van on route', is_field_role: 1 },
      { id: 'role-merchandiser', name: 'Merchandiser', level: 1, description: 'In-store merchandising and shelf management', is_field_role: 1 },
      { id: 'role-route-sup', name: 'Route Supervisor', level: 2, description: 'Supervises multiple routes and salesmen', is_field_role: 0 },
      { id: 'role-depot-mgr', name: 'Depot Manager', level: 3, description: 'Manages warehouse/depot operations and sales', is_field_role: 0 },
      { id: 'role-ka-mgr', name: 'Key Account Manager', level: 3, description: 'Manages key accounts (hypermarkets, supermarkets)', is_field_role: 0 },
      { id: 'role-sales-mgr', name: 'Sales Manager', level: 4, description: 'Oversees overall sales operations across depots', is_field_role: 0 },
      { id: 'role-gm', name: 'General Manager', level: 5, description: 'General manager of distribution operations', is_field_role: 0 },
    ];
    const stmts = roles.map(r => ({
      sql: 'INSERT OR IGNORE INTO roles (id, name, level, description, is_field_role) VALUES (?, ?, ?, ?, ?)',
      args: [r.id, r.name, r.level, r.description, r.is_field_role],
    }));
    await db.batch(stmts);
    console.log(`  Roles: ${roles.length} inserted`);
  }

  // ==================== TERRITORIES ====================
  const territories = [
    { id: 'terr-uae', name: 'UAE', type: 'national', parent_id: null },
  ];

  const warehouses = yaumiDb.prepare('SELECT warehouse_code, warehouse_name FROM dim_warehouse').all();
  for (const wh of warehouses) {
    territories.push({
      id: `terr-wh-${wh.warehouse_code}`,
      name: wh.warehouse_name,
      type: 'region',
      parent_id: 'terr-uae',
    });
  }

  const routeWarehouseMap = yaumiDb.prepare(
    `SELECT DISTINCT route_code, warehouse_code FROM fact_sales WHERE route_code IS NOT NULL AND warehouse_code IS NOT NULL`
  ).all();
  const routeToWarehouse = {};
  for (const rw of routeWarehouseMap) {
    routeToWarehouse[rw.route_code] = rw.warehouse_code;
  }

  const routes = yaumiDb.prepare('SELECT route_code FROM dim_route').all();
  for (const rt of routes) {
    const whCode = routeToWarehouse[rt.route_code];
    territories.push({
      id: `terr-rt-${rt.route_code}`,
      name: `Route ${rt.route_code}`,
      type: 'area',
      parent_id: whCode ? `terr-wh-${whCode}` : 'terr-uae',
    });
  }

  await upsert('territories', territories);
  console.log(`  Territories: ${territories.length} synced (${warehouses.length} depots, ${routes.length} routes)`);

  // ==================== PRODUCTS ====================
  const yaumiItems = yaumiDb.prepare('SELECT item_code, item_name, category_code, category_name FROM dim_item').all();
  const productRows = yaumiItems.map(item => ({
    id: `prod-${item.item_code}`,
    name: item.item_name,
    sku: item.item_code,
    category: item.category_name || item.category_code || 'Others',
    subcategory: item.category_code || '',
    unit_price: 0,
    is_strategic: ['AB', 'SB'].includes(item.category_code) ? 1 : 0,
    is_new_launch: 0,
    tags: JSON.stringify([item.category_code?.toLowerCase()].filter(Boolean)),
  }));
  await upsert('products', productRows);

  // Update unit_price from avg of recent transactions
  const avgPrices = yaumiDb.prepare(
    `SELECT item_code, AVG(unit_price) as avg_price FROM fact_sales
     WHERE unit_price > 0 AND trx_type = 'SalesInvoice'
     GROUP BY item_code`
  ).all();
  const priceStmts = avgPrices.map(p => ({
    sql: 'UPDATE products SET unit_price = ? WHERE sku = ?',
    args: [Math.round(p.avg_price * 100) / 100, p.item_code],
  }));
  for (let i = 0; i < priceStmts.length; i += 100) {
    await db.batch(priceStmts.slice(i, i + 100));
  }
  console.log(`  Products: ${productRows.length} synced, ${avgPrices.length} prices updated`);

  // ==================== CUSTOMERS ====================
  const yaumiCustomers = yaumiDb.prepare('SELECT customer_code, customer_name, sales_class_code, sales_class_name, customer_group_code, customer_group_name FROM dim_customer').all();
  const customerRows = yaumiCustomers.map(c => ({
    id: `cust-${c.customer_code}`,
    name: c.customer_name || `Customer ${c.customer_code}`,
    channel: c.sales_class_code || 'Other',
    channel_name: c.sales_class_name || '',
    customer_group: c.customer_group_code || '',
    customer_group_name: c.customer_group_name || '',
    territory_id: 'terr-uae',
    credit_limit: 0,
    tags: JSON.stringify([c.sales_class_code, c.customer_group_code].filter(Boolean)),
  }));
  await upsert('customers', customerRows);

  // Map customers to territories
  const customerRoutes = yaumiDb.prepare(
    `SELECT customer_code, route_code, COUNT(*) as cnt
     FROM fact_sales WHERE route_code IS NOT NULL
     GROUP BY customer_code, route_code
     ORDER BY customer_code, cnt DESC`
  ).all();
  const custTerr = {};
  for (const cr of customerRoutes) {
    if (!custTerr[cr.customer_code]) {
      custTerr[cr.customer_code] = `terr-rt-${cr.route_code}`;
    }
  }
  const custTerrStmts = Object.entries(custTerr).map(([code, terrId]) => ({
    sql: 'UPDATE customers SET territory_id = ? WHERE id = ?',
    args: [terrId, `cust-${code}`],
  }));
  for (let i = 0; i < custTerrStmts.length; i += 100) {
    await db.batch(custTerrStmts.slice(i, i + 100));
  }
  console.log(`  Customers: ${customerRows.length} synced, ${Object.keys(custTerr).length} territory-mapped`);

  // ==================== EMPLOYEES ====================
  const yaumiSalesmen = yaumiDb.prepare('SELECT salesman_code, salesman_name FROM dim_salesman').all();

  const salesmanRoutes = yaumiDb.prepare(
    `SELECT salesman_code, route_code, COUNT(*) as cnt
     FROM fact_sales WHERE route_code IS NOT NULL
     GROUP BY salesman_code, route_code
     ORDER BY salesman_code, cnt DESC`
  ).all();
  const salesmanToRoute = {};
  for (const sr of salesmanRoutes) {
    if (!salesmanToRoute[sr.salesman_code]) {
      salesmanToRoute[sr.salesman_code] = sr.route_code;
    }
  }

  const employeeRows = yaumiSalesmen.map(s => {
    const routeCode = salesmanToRoute[s.salesman_code];
    return {
      id: `emp-${s.salesman_code}`,
      name: s.salesman_name,
      email: `${s.salesman_code}@yaumi.ae`,
      external_id: s.salesman_code,
      role_id: 'role-salesman',
      territory_id: routeCode ? `terr-rt-${routeCode}` : 'terr-uae',
      reports_to: null,
      base_salary: 5000,
      hire_date: '2020-01-01',
      is_active: 1,
    };
  });

  await upsert('employees', employeeRows);
  console.log(`  Employees: ${employeeRows.length} synced from YOMI salesmen`);

  yaumiDb.close();
  console.log('YOMI sync complete.');
}

/**
 * Import transactions from YOMI for a given period (YYYY-MM format).
 */
export async function importTransactions(db, period) {
  let Database;
  try {
    Database = (await import('better-sqlite3')).default;
  } catch {
    console.log('better-sqlite3 not available, cannot import transactions');
    return 0;
  }

  let yaumiDb;
  try {
    yaumiDb = new Database(YAUMI_DB_PATH, { readonly: true });
  } catch {
    console.warn(`YOMI DB not found, cannot import transactions.`);
    return 0;
  }

  const [year, month] = period.split('-');
  const startDate = `${year}-${month}-01`;
  const endMonth = parseInt(month) === 12 ? 1 : parseInt(month) + 1;
  const endYear = parseInt(month) === 12 ? parseInt(year) + 1 : parseInt(year);
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  await db.prepare('DELETE FROM transactions WHERE period = ?').run(period);

  const rows = yaumiDb.prepare(
    `SELECT salesman_code, customer_code, item_code, route_code,
            trx_type, quantity_pcs, unit_price, total_discount_amount,
            total_tax_amount, trx_date
     FROM fact_sales
     WHERE trx_date >= ? AND trx_date < ?
     ORDER BY trx_date`
  ).all(startDate + 'T00:00:00', endDate + 'T00:00:00');

  const mapTxType = (type) => {
    if (type === 'SalesInvoice') return 'sale';
    if (type === 'Good Return' || type === 'Bad Return') return 'return';
    return 'sale';
  };

  let count = 0;
  const batchSize = 100;
  let batch = [];

  const flushBatch = async (items) => {
    const stmts = items.map(item => ({
      sql: `INSERT INTO transactions (id, employee_id, customer_id, product_id, transaction_type,
         quantity, amount, transaction_date, period, territory_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: item,
    }));
    await db.batch(stmts);
  };

  for (const row of rows) {
    const txType = mapTxType(row.trx_type);
    const qty = Math.abs(row.quantity_pcs || 0);
    const grossAmount = qty * (row.unit_price || 0);
    const netAmount = grossAmount - (row.total_discount_amount || 0);
    const date = row.trx_date ? row.trx_date.split('T')[0] : startDate;

    batch.push([
      uuid(),
      `emp-${row.salesman_code}`,
      `cust-${row.customer_code}`,
      `prod-${row.item_code}`,
      txType,
      qty,
      Math.round(Math.abs(netAmount) * 100) / 100,
      date,
      period,
      row.route_code ? `terr-rt-${row.route_code}` : 'terr-uae',
    ]);

    if (batch.length >= batchSize) {
      await flushBatch(batch);
      count += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await flushBatch(batch);
    count += batch.length;
  }

  yaumiDb.close();
  console.log(`Imported ${count} transactions for period ${period} from YOMI`);
  return count;
}
