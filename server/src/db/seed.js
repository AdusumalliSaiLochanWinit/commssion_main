import { v4 as uuid } from 'uuid';
import { initDb, getDb } from './database.js';
import { importTransactions } from './yaumiSync.js';

function seed() {
  const db = initDb();

  // Check if commission-specific data already seeded
  const planCount = db.prepare('SELECT COUNT(*) as c FROM commission_plans').get();
  if (planCount.c > 0) {
    console.log('Commission plans already seeded. Drop commission.db to re-seed.');
    return;
  }

  const insert = (table, rows) => {
    if (rows.length === 0) return;
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => '?').join(',');
    const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`);
    const tx = db.transaction((items) => {
      for (const item of items) {
        stmt.run(...cols.map(c => item[c]));
      }
    });
    tx(rows);
  };

  // ==================== KPI DEFINITIONS ====================
  // These are commission-specific, not in YOMI
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
  insert('kpi_definitions', kpis);

  // ==================== COMMISSION PLANS ====================
  const plans = [
    {
      id: 'plan-01',
      name: 'Salesman Monthly Incentive',
      description: 'Monthly commission plan for route salesmen based on revenue, distribution, and collection KPIs',
      status: 'active',
      plan_type: 'monthly',
      effective_from: '2026-01-01',
      effective_to: '2026-12-31',
      base_payout: 2000,
      created_by: null,
    },
    {
      id: 'plan-02',
      name: 'Supervisor Quarterly Bonus',
      description: 'Quarterly bonus plan for route supervisors and depot managers based on team performance',
      status: 'active',
      plan_type: 'quarterly',
      effective_from: '2026-01-01',
      effective_to: '2026-12-31',
      base_payout: 5000,
      created_by: null,
    },
  ];
  insert('commission_plans', plans);

  // Plan Roles
  const planRoles = [
    { id: uuid(), plan_id: 'plan-01', role_id: 'role-salesman' },
    { id: uuid(), plan_id: 'plan-01', role_id: 'role-van-driver' },
    { id: uuid(), plan_id: 'plan-01', role_id: 'role-ka-mgr' },
    { id: uuid(), plan_id: 'plan-02', role_id: 'role-route-sup' },
    { id: uuid(), plan_id: 'plan-02', role_id: 'role-depot-mgr' },
  ];
  insert('plan_roles', planRoles);

  // Plan Territories - use YOMI-synced territory IDs
  const planTerritories = [];
  const allRoutes = db.prepare("SELECT id FROM territories WHERE type = 'area'").all();
  for (const rt of allRoutes) {
    planTerritories.push({ id: uuid(), plan_id: 'plan-01', territory_id: rt.id });
  }
  planTerritories.push({ id: uuid(), plan_id: 'plan-01', territory_id: 'terr-uae' });
  const depots = db.prepare("SELECT id FROM territories WHERE type = 'region'").all();
  for (const d of depots) {
    planTerritories.push({ id: uuid(), plan_id: 'plan-02', territory_id: d.id });
  }
  insert('plan_territories', planTerritories);

  // ==================== SLAB SETS ====================
  const slabSets = [
    { id: 'slab-01', name: 'Revenue Step Slab', type: 'step', plan_id: 'plan-01', kpi_id: 'kpi-01' },
    { id: 'slab-02', name: 'Units Progressive Slab', type: 'progressive', plan_id: 'plan-01', kpi_id: 'kpi-03' },
    { id: 'slab-03', name: 'Collection Accelerator', type: 'accelerator', plan_id: 'plan-01', kpi_id: 'kpi-06' },
    { id: 'slab-04', name: 'Team Revenue Slab', type: 'step', plan_id: 'plan-02', kpi_id: 'kpi-11' },
  ];
  insert('slab_sets', slabSets);

  const slabTiers = [
    { id: uuid(), slab_set_id: 'slab-01', tier_order: 1, min_percent: 0, max_percent: 70, rate: 0, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-01', tier_order: 2, min_percent: 70, max_percent: 85, rate: 3, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-01', tier_order: 3, min_percent: 85, max_percent: 100, rate: 5, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-01', tier_order: 4, min_percent: 100, max_percent: 120, rate: 8, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-01', tier_order: 5, min_percent: 120, max_percent: null, rate: 12, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-02', tier_order: 1, min_percent: 0, max_percent: 80, rate: 2, rate_type: 'per_unit' },
    { id: uuid(), slab_set_id: 'slab-02', tier_order: 2, min_percent: 80, max_percent: 100, rate: 4, rate_type: 'per_unit' },
    { id: uuid(), slab_set_id: 'slab-02', tier_order: 3, min_percent: 100, max_percent: 130, rate: 7, rate_type: 'per_unit' },
    { id: uuid(), slab_set_id: 'slab-02', tier_order: 4, min_percent: 130, max_percent: null, rate: 10, rate_type: 'per_unit' },
    { id: uuid(), slab_set_id: 'slab-03', tier_order: 1, min_percent: 0, max_percent: 100, rate: 5, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-03', tier_order: 2, min_percent: 100, max_percent: null, rate: 10, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-04', tier_order: 1, min_percent: 0, max_percent: 80, rate: 0, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-04', tier_order: 2, min_percent: 80, max_percent: 100, rate: 4, rate_type: 'percentage' },
    { id: uuid(), slab_set_id: 'slab-04', tier_order: 3, min_percent: 100, max_percent: null, rate: 7, rate_type: 'percentage' },
  ];
  insert('slab_tiers', slabTiers);

  const planKpis = [
    { id: uuid(), plan_id: 'plan-01', kpi_id: 'kpi-01', weight: 40, target_value: 50000, slab_set_id: 'slab-01' },
    { id: uuid(), plan_id: 'plan-01', kpi_id: 'kpi-03', weight: 20, target_value: 5000, slab_set_id: 'slab-02' },
    { id: uuid(), plan_id: 'plan-01', kpi_id: 'kpi-06', weight: 20, target_value: 85, slab_set_id: 'slab-03' },
    { id: uuid(), plan_id: 'plan-01', kpi_id: 'kpi-04', weight: 10, target_value: 50, slab_set_id: null },
    { id: uuid(), plan_id: 'plan-01', kpi_id: 'kpi-07', weight: 10, target_value: 5, slab_set_id: null },
    { id: uuid(), plan_id: 'plan-02', kpi_id: 'kpi-11', weight: 50, target_value: 300000, slab_set_id: 'slab-04' },
    { id: uuid(), plan_id: 'plan-02', kpi_id: 'kpi-12', weight: 30, target_value: 90, slab_set_id: null },
    { id: uuid(), plan_id: 'plan-02', kpi_id: 'kpi-14', weight: 20, target_value: 95, slab_set_id: null },
  ];
  insert('plan_kpis', planKpis);

  // ==================== RULE SETS ====================
  insert('rule_sets', [
    { id: 'rs-01', plan_id: 'plan-01', name: 'Bakery Product Rules', description: 'Include all bakery product categories' },
    { id: 'rs-02', plan_id: 'plan-01', name: 'Customer Channel Rules', description: 'Customer channel filtering' },
  ]);
  insert('rules', [
    { id: uuid(), rule_set_id: 'rs-01', dimension: 'product_category', rule_type: 'include', match_type: 'category', match_values: '["ARABIC BREAD","SLICED BREAD","BUNS","ROLLS","CUP CAKES","POUND CAKES","PUFFS","SLICED CAKES","Fresh Tortilla","TORTILLA","OTHERS"]', priority: 1 },
    { id: uuid(), rule_set_id: 'rs-02', dimension: 'customer_channel', rule_type: 'include', match_type: 'category', match_values: '["KH","KS","LG","MG","SG","HO","EC","MM","PH","PS"]', priority: 1 },
  ]);

  // ==================== ELIGIBILITY / MULTIPLIER / PENALTY / CAP ====================
  insert('eligibility_rules', [
    { id: uuid(), plan_id: 'plan-01', metric: 'min_sales', operator: '>=', threshold: 10000, action: 'zero_payout', reduction_percent: 0, is_active: 1 },
    { id: uuid(), plan_id: 'plan-01', metric: 'max_return_percent', operator: '<=', threshold: 10, action: 'warning_only', reduction_percent: 0, is_active: 1 },
  ]);
  insert('multiplier_rules', [
    { id: uuid(), plan_id: 'plan-01', name: 'Revenue Growth Bonus', type: 'growth', condition_metric: 'revenue_growth_percent', condition_operator: '>=', condition_value: 15, multiplier_value: 1.15, stacking_mode: 'multiplicative', is_active: 1 },
    { id: uuid(), plan_id: 'plan-01', name: 'Strategic SKU Push', type: 'strategic_sku', condition_metric: 'strategic_sku_percent', condition_operator: '>=', condition_value: 30, multiplier_value: 1.10, stacking_mode: 'multiplicative', is_active: 1 },
  ]);
  insert('penalty_rules', [
    { id: uuid(), plan_id: 'plan-01', name: 'High Returns Penalty', trigger_metric: 'return_percent', trigger_operator: '>', trigger_value: 8, penalty_type: 'percentage', penalty_value: 15, is_active: 1 },
  ]);
  insert('capping_rules', [
    { id: uuid(), plan_id: 'plan-01', cap_type: 'max_per_plan', cap_value: 10000, is_active: 1 },
    { id: uuid(), plan_id: 'plan-01', cap_type: 'percent_of_salary', cap_value: 150, is_active: 1 },
  ]);
  insert('split_rules', [
    { id: 'split-01', plan_id: 'plan-01', name: 'Salesman / Van Driver Split', trigger_condition: 'role IN (role-salesman, role-van-driver)', is_active: 1 },
  ]);
  insert('split_participants', [
    { id: uuid(), split_rule_id: 'split-01', role_id: 'role-salesman', split_percent: 60 },
    { id: uuid(), split_rule_id: 'split-01', role_id: 'role-van-driver', split_percent: 40 },
  ]);

  // ==================== IMPORT TRANSACTIONS FROM YOMI ====================
  // Import a recent period that has data
  console.log('Importing transactions from YOMI...');
  const periods = ['2024-01', '2024-02', '2024-03', '2025-01'];
  for (const p of periods) {
    const count = importTransactions(db, p);
    if (count > 0) break; // Use the first period that has data
  }

  console.log('Seed complete!');
  const stats = {
    Roles: db.prepare('SELECT COUNT(*) as c FROM roles').get().c,
    Territories: db.prepare('SELECT COUNT(*) as c FROM territories').get().c,
    Products: db.prepare('SELECT COUNT(*) as c FROM products').get().c,
    Customers: db.prepare('SELECT COUNT(*) as c FROM customers').get().c,
    Employees: db.prepare('SELECT COUNT(*) as c FROM employees').get().c,
    KPIs: db.prepare('SELECT COUNT(*) as c FROM kpi_definitions').get().c,
    Plans: db.prepare('SELECT COUNT(*) as c FROM commission_plans').get().c,
    Transactions: db.prepare('SELECT COUNT(*) as c FROM transactions').get().c,
  };
  for (const [k, v] of Object.entries(stats)) {
    console.log(`  ${k}: ${v}`);
  }
}

seed();
