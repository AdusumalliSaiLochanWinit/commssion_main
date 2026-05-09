import pg from 'pg';
import { v4 as uuid } from 'uuid';

const DEFAULT_SOURCE_DB_URL = 'postgresql://choithram:choithram@10.20.53.10:5432/pepsicodubaidev';
let sourcePool;

function getSourcePool() {
  if (!sourcePool) {
    const connectionString = process.env.SOURCE_DB_URL || DEFAULT_SOURCE_DB_URL;
    sourcePool = new pg.Pool({
      connectionString,
      ssl: connectionString.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
      max: 3,
      idleTimeoutMillis: 30000,
    });
  }
  return sourcePool;
}

async function sourceAll(sql, params = []) {
  const pool = getSourcePool();
  const result = await pool.query(sql, params);
  return result.rows;
}

async function tableExists(tableName) {
  const rows = await sourceAll(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return !!rows[0]?.exists;
}

async function getTableColumns(tableName) {
  const rows = await sourceAll(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return rows.map(r => r.column_name);
}

/**
 * Sync reference data from source PostgreSQL DB into Commission DB.
 */
export async function syncFromYaumi(db) {
  try {
    // Smoke test connection early for clear startup logs.
    await sourceAll('SELECT 1');
  } catch (err) {
    console.warn(`Source PostgreSQL unavailable, skipping sync. (${err.message})`);
    return;
  }

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

  console.log('Syncing reference data from source PostgreSQL...');
  const commissionSnapshotTables = ['roles', 'territories', 'products', 'customers', 'employees'];
  const hasCommissionSnapshot = (await Promise.all(commissionSnapshotTables.map(tableExists))).every(Boolean);

  if (hasCommissionSnapshot) {
    // Preferred path for this server: source already has commission-shaped master tables.
    const sourceTerritories = await sourceAll(
      `SELECT id, name, type, parent_id
       FROM territories`
    );
    await upsert('territories', sourceTerritories);

    const sourceProducts = await sourceAll(
      `SELECT id, name, sku, COALESCE(category, 'Others') AS category, COALESCE(subcategory, '') AS subcategory,
              COALESCE(unit_price, 0) AS unit_price, COALESCE(is_strategic, 0) AS is_strategic,
              COALESCE(is_new_launch, 0) AS is_new_launch, COALESCE(tags, '[]') AS tags
       FROM products`
    );
    await upsert('products', sourceProducts);

    const sourceCustomers = await sourceAll(
      `SELECT id, name, COALESCE(channel, 'Other') AS channel, COALESCE(channel_name, '') AS channel_name,
              COALESCE(customer_group, '') AS customer_group, COALESCE(customer_group_name, '') AS customer_group_name,
              COALESCE(territory_id, 'terr-uae') AS territory_id, COALESCE(credit_limit, 0) AS credit_limit,
              COALESCE(tags, '[]') AS tags
       FROM customers`
    );
    await upsert('customers', sourceCustomers);

    const sourceEmployees = await sourceAll(
      `SELECT id, name, email, external_id, role_id, COALESCE(territory_id, 'terr-uae') AS territory_id,
              NULL::text AS reports_to, COALESCE(base_salary, 0) AS base_salary, COALESCE(hire_date, '2020-01-01') AS hire_date,
              COALESCE(is_active, 1) AS is_active
       FROM employees`
    );
    await upsert('employees', sourceEmployees);

    console.log(
      `  Synced commission snapshot: territories=${sourceTerritories.length}, products=${sourceProducts.length}, customers=${sourceCustomers.length}, employees=${sourceEmployees.length}`
    );
    console.log('Source sync complete.');
    return;
  }

  const hasDimWarehouse = await tableExists('dim_warehouse');
  const hasDimRoute = await tableExists('dim_route');
  const hasDimItem = await tableExists('dim_item');
  const hasDimCustomer = await tableExists('dim_customer');
  const hasDimSalesman = await tableExists('dim_salesman');
  const factSalesColumns = new Set(await getTableColumns('fact_sales'));
  const hasFactSales = factSalesColumns.size > 0;

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

  const warehouses = hasDimWarehouse
    ? await sourceAll('SELECT warehouse_code, warehouse_name FROM dim_warehouse')
    : [];
  for (const wh of warehouses) {
    territories.push({
      id: `terr-wh-${wh.warehouse_code}`,
      name: wh.warehouse_name,
      type: 'region',
      parent_id: 'terr-uae',
    });
  }

  const routeWarehouseMap = hasFactSales && factSalesColumns.has('route_code') && factSalesColumns.has('warehouse_code')
    ? await sourceAll(
        `SELECT DISTINCT route_code, warehouse_code
         FROM fact_sales
         WHERE route_code IS NOT NULL AND warehouse_code IS NOT NULL`
      )
    : [];
  const routeToWarehouse = {};
  for (const rw of routeWarehouseMap) {
    routeToWarehouse[rw.route_code] = rw.warehouse_code;
  }

  const routes = hasDimRoute
    ? await sourceAll('SELECT route_code FROM dim_route')
    : (hasFactSales && factSalesColumns.has('route_code')
        ? await sourceAll('SELECT DISTINCT route_code FROM fact_sales WHERE route_code IS NOT NULL')
        : []);
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
  const yaumiItems = hasDimItem
    ? await sourceAll('SELECT item_code, item_name, category_code, category_name FROM dim_item')
    : (hasFactSales && factSalesColumns.has('product_code')
        ? await sourceAll(
            `SELECT DISTINCT product_code AS item_code
             FROM fact_sales
             WHERE product_code IS NOT NULL`
          )
        : []);
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
  let avgPrices = [];
  if (hasFactSales && factSalesColumns.has('product_code') && factSalesColumns.has('gross_amt')) {
    avgPrices = await sourceAll(
      `SELECT product_code AS item_code, AVG(gross_amt) as avg_price
       FROM fact_sales
       WHERE gross_amt > 0
       GROUP BY product_code`
    );
  } else if (hasFactSales && factSalesColumns.has('item_code') && factSalesColumns.has('unit_price')) {
    avgPrices = await sourceAll(
      `SELECT item_code, AVG(unit_price) as avg_price
       FROM fact_sales
       WHERE unit_price > 0
       GROUP BY item_code`
    );
  }
  const priceStmts = avgPrices.map(p => ({
    sql: 'UPDATE products SET unit_price = ? WHERE sku = ?',
    args: [Math.round(p.avg_price * 100) / 100, p.item_code],
  }));
  for (let i = 0; i < priceStmts.length; i += 100) {
    await db.batch(priceStmts.slice(i, i + 100));
  }
  console.log(`  Products: ${productRows.length} synced, ${avgPrices.length} prices updated`);

  // ==================== CUSTOMERS ====================
  const yaumiCustomers = hasDimCustomer
    ? await sourceAll(
        `SELECT customer_code, customer_name, sales_class_code, sales_class_name, customer_group_code, customer_group_name
         FROM dim_customer`
      )
    : (hasFactSales && factSalesColumns.has('customer_code')
        ? await sourceAll(
            `SELECT DISTINCT customer_code
             FROM fact_sales
             WHERE customer_code IS NOT NULL`
          )
        : []);
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
  const customerRoutes = hasFactSales && factSalesColumns.has('route_code') && factSalesColumns.has('customer_code')
    ? await sourceAll(
        `SELECT customer_code, route_code, COUNT(*) as cnt
         FROM fact_sales
         WHERE route_code IS NOT NULL
         GROUP BY customer_code, route_code
         ORDER BY customer_code, cnt DESC`
      )
    : [];
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
  const yaumiSalesmen = hasDimSalesman
    ? await sourceAll('SELECT salesman_code, salesman_name FROM dim_salesman')
    : (hasFactSales && factSalesColumns.has('user_code')
        ? await sourceAll(
            `SELECT DISTINCT user_code AS salesman_code
             FROM fact_sales
             WHERE user_code IS NOT NULL`
          )
        : []);

  const salesmanRoutes = hasFactSales && factSalesColumns.has('route_code') && factSalesColumns.has('salesman_code')
    ? await sourceAll(
        `SELECT salesman_code, route_code, COUNT(*) as cnt
         FROM fact_sales
         WHERE route_code IS NOT NULL
         GROUP BY salesman_code, route_code
         ORDER BY salesman_code, cnt DESC`
      )
    : (hasFactSales && factSalesColumns.has('route_code') && factSalesColumns.has('user_code')
        ? await sourceAll(
            `SELECT user_code AS salesman_code, route_code, COUNT(*) as cnt
             FROM fact_sales
             WHERE route_code IS NOT NULL
             GROUP BY user_code, route_code
             ORDER BY user_code, cnt DESC`
          )
        : []);
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
      name: s.salesman_name || `Salesman ${s.salesman_code}`,
      email: `${s.salesman_code}@choithram.local`,
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
  console.log(`  Employees: ${employeeRows.length} synced from source salesmen`);
  console.log('Source sync complete.');
}

/**
 * Import transactions from source PostgreSQL for a given period (YYYY-MM format).
 */
export async function importTransactions(db, period) {
  try {
    await sourceAll('SELECT 1');
  } catch (err) {
    console.warn(`Source PostgreSQL unavailable, cannot import transactions. (${err.message})`);
    return 0;
  }

  const [year, month] = period.split('-');
  const startDate = `${year}-${month}-01`;
  const endMonth = parseInt(month) === 12 ? 1 : parseInt(month) + 1;
  const endYear = parseInt(month) === 12 ? parseInt(year) + 1 : parseInt(year);
  const endDate = `${endYear}-${String(endMonth).padStart(2, '0')}-01`;

  await db.prepare('DELETE FROM transactions WHERE period = ?').run(period);

  const hasSourceTransactions = await tableExists('transactions');

  if (hasSourceTransactions) {
    const txCols = new Set(await getTableColumns('transactions'));
    const periodPredicate = txCols.has('period')
      ? 'period = $1'
      : 'transaction_date >= $2 AND transaction_date < $3';

    const queryParams = txCols.has('period')
      ? [period]
      : [period, startDate, endDate];

    const sourceRows = await sourceAll(
      `SELECT employee_id, customer_id, product_id, transaction_type, quantity, amount,
              transaction_date, territory_id
       FROM transactions
       WHERE ${periodPredicate}
       ORDER BY transaction_date`,
      queryParams
    );

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

    for (const row of sourceRows) {
      if (!row.employee_id || !row.customer_id || !row.product_id) continue;
      batch.push([
        uuid(),
        row.employee_id,
        row.customer_id,
        row.product_id,
        row.transaction_type || 'sale',
        Math.abs(Number(row.quantity || 0)),
        Math.round(Math.abs(Number(row.amount || 0)) * 100) / 100,
        row.transaction_date ? String(row.transaction_date).split('T')[0] : startDate,
        period,
        row.territory_id || 'terr-uae',
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

    console.log(`Imported ${count} transactions for period ${period} from source transactions table`);
    return count;
  }

  const factSalesColumns = new Set(await getTableColumns('fact_sales'));
  const employeeCol = factSalesColumns.has('salesman_code') ? 'salesman_code' : 'user_code';
  const productCol = factSalesColumns.has('item_code') ? 'item_code' : 'product_code';
  const routeCol = factSalesColumns.has('route_code') ? 'route_code' : 'NULL::text AS route_code';
  const qtyCol = factSalesColumns.has('quantity_pcs') ? 'quantity_pcs' : '1 AS quantity_pcs';
  const priceCol = factSalesColumns.has('unit_price') ? 'unit_price' : 'gross_amt AS unit_price';
  const discountCol = factSalesColumns.has('total_discount_amount') ? 'total_discount_amount' : '0 AS total_discount_amount';
  const taxCol = factSalesColumns.has('total_tax_amount') ? 'total_tax_amount' : 'tax_amt AS total_tax_amount';
  const trxTypeCol = factSalesColumns.has('trx_type') ? 'trx_type' : "'SalesInvoice' AS trx_type";

  const rows = await sourceAll(
    `SELECT ${employeeCol} AS salesman_code, customer_code, ${productCol} AS item_code, ${routeCol},
            ${trxTypeCol}, ${qtyCol}, ${priceCol}, ${discountCol}, ${taxCol}, trx_date
     FROM fact_sales
     WHERE trx_date >= $1 AND trx_date < $2
       AND customer_code IS NOT NULL
       AND ${employeeCol} IS NOT NULL
       AND ${productCol} IS NOT NULL
     ORDER BY trx_date`,
    [startDate, endDate]
  );

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

  console.log(`Imported ${count} transactions for period ${period} from source PostgreSQL`);
  return count;
}
