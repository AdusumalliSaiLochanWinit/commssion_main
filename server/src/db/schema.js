export async function createSchema(db) {
  await db.exec(`
    -- =============================================
    -- REFERENCE TABLES
    -- =============================================

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      level INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      is_field_role INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS territories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('national','region','area','territory')),
      parent_id TEXT REFERENCES territories(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      external_id TEXT,
      role_id TEXT NOT NULL REFERENCES roles(id),
      territory_id TEXT REFERENCES territories(id),
      reports_to TEXT REFERENCES employees(id),
      base_salary REAL NOT NULL DEFAULT 0,
      hire_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      subcategory TEXT,
      unit_price REAL NOT NULL DEFAULT 0,
      is_strategic INTEGER NOT NULL DEFAULT 0,
      is_new_launch INTEGER NOT NULL DEFAULT 0,
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      channel TEXT NOT NULL,
      channel_name TEXT,
      customer_group TEXT,
      customer_group_name TEXT,
      territory_id TEXT REFERENCES territories(id),
      credit_limit REAL DEFAULT 0,
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- =============================================
    -- KPI DEFINITIONS
    -- =============================================

    CREATE TABLE IF NOT EXISTS kpi_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      description TEXT,
      formula TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'currency',
      direction TEXT NOT NULL DEFAULT 'higher_is_better' CHECK(direction IN ('higher_is_better','lower_is_better')),
      applicable_roles TEXT NOT NULL DEFAULT '[]',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- =============================================
    -- COMMISSION PLANS
    -- =============================================

    CREATE TABLE IF NOT EXISTS commission_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','expired','archived')),
      plan_type TEXT NOT NULL DEFAULT 'monthly' CHECK(plan_type IN ('monthly','quarterly','annual')),
      effective_from TEXT NOT NULL,
      effective_to TEXT NOT NULL,
      base_payout REAL NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS plan_roles (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id),
      UNIQUE(plan_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS plan_territories (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
      territory_id TEXT NOT NULL REFERENCES territories(id),
      UNIQUE(plan_id, territory_id)
    );

    CREATE TABLE IF NOT EXISTS plan_kpis (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
      kpi_id TEXT NOT NULL REFERENCES kpi_definitions(id),
      weight REAL NOT NULL DEFAULT 0,
      target_value REAL NOT NULL DEFAULT 0,
      slab_set_id TEXT REFERENCES slab_sets(id),
      UNIQUE(plan_id, kpi_id)
    );

    -- =============================================
    -- SLAB CONFIGURATION
    -- =============================================

    CREATE TABLE IF NOT EXISTS slab_sets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'step' CHECK(type IN ('step','progressive','accelerator','decelerator','reverse','open_ended')),
      plan_id TEXT REFERENCES commission_plans(id) ON DELETE CASCADE,
      kpi_id TEXT REFERENCES kpi_definitions(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS slab_tiers (
      id TEXT PRIMARY KEY,
      slab_set_id TEXT NOT NULL REFERENCES slab_sets(id) ON DELETE CASCADE,
      tier_order INTEGER NOT NULL,
      min_percent REAL NOT NULL,
      max_percent REAL,
      rate REAL NOT NULL DEFAULT 0,
      rate_type TEXT NOT NULL DEFAULT 'percentage' CHECK(rate_type IN ('percentage','fixed','per_unit')),
      UNIQUE(slab_set_id, tier_order)
    );

    -- =============================================
    -- RULE ENGINE
    -- =============================================

    CREATE TABLE IF NOT EXISTS rule_sets (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      rule_set_id TEXT NOT NULL REFERENCES rule_sets(id) ON DELETE CASCADE,
      dimension TEXT NOT NULL CHECK(dimension IN ('product','customer','product_category','customer_channel','customer_group')),
      rule_type TEXT NOT NULL CHECK(rule_type IN ('include','exclude')),
      match_type TEXT NOT NULL DEFAULT 'exact' CHECK(match_type IN ('exact','category','tag')),
      match_values TEXT NOT NULL DEFAULT '[]',
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS eligibility_rules (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
      metric TEXT NOT NULL CHECK(metric IN ('min_sales','min_collection_percent','max_return_percent','min_active_days','min_lines_sold')),
      operator TEXT NOT NULL DEFAULT '>=' CHECK(operator IN ('>=','<=','>','<','=')),
      threshold REAL NOT NULL,
      action TEXT NOT NULL DEFAULT 'zero_payout' CHECK(action IN ('zero_payout','reduce_percent','warning_only')),
      reduction_percent REAL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS multiplier_rules (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('growth','strategic_sku','new_launch','channel_mix','collection_speed')),
      condition_metric TEXT NOT NULL,
      condition_operator TEXT NOT NULL DEFAULT '>=' CHECK(condition_operator IN ('>=','<=','>','<','=')),
      condition_value REAL NOT NULL,
      multiplier_value REAL NOT NULL DEFAULT 1.0,
      stacking_mode TEXT NOT NULL DEFAULT 'multiplicative' CHECK(stacking_mode IN ('additive','multiplicative','highest_only')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS penalty_rules (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      trigger_metric TEXT NOT NULL,
      trigger_operator TEXT NOT NULL DEFAULT '>' CHECK(trigger_operator IN ('>=','<=','>','<','=')),
      trigger_value REAL NOT NULL,
      penalty_type TEXT NOT NULL DEFAULT 'percentage' CHECK(penalty_type IN ('percentage','fixed','slab_downgrade')),
      penalty_value REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS capping_rules (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
      cap_type TEXT NOT NULL CHECK(cap_type IN ('max_per_plan','percent_of_salary','max_per_kpi')),
      cap_value REAL NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS split_rules (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      trigger_condition TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS split_participants (
      id TEXT PRIMARY KEY,
      split_rule_id TEXT NOT NULL REFERENCES split_rules(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id),
      split_percent REAL NOT NULL,
      UNIQUE(split_rule_id, role_id)
    );

    -- =============================================
    -- TRANSACTIONS
    -- =============================================

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employees(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      transaction_type TEXT NOT NULL DEFAULT 'sale' CHECK(transaction_type IN ('sale','return','collection')),
      quantity REAL NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      transaction_date TEXT NOT NULL,
      period TEXT NOT NULL,
      territory_id TEXT REFERENCES territories(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- =============================================
    -- CALCULATION RESULTS
    -- =============================================

    CREATE TABLE IF NOT EXISTS calculation_runs (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES commission_plans(id),
      period TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','failed','locked')),
      is_simulation INTEGER NOT NULL DEFAULT 0,
      simulation_params TEXT,
      total_payout REAL DEFAULT 0,
      employee_count INTEGER DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      calculation_details TEXT DEFAULT '{}',
      created_by TEXT
    );

    CREATE TABLE IF NOT EXISTS employee_payouts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES calculation_runs(id),
      employee_id TEXT NOT NULL REFERENCES employees(id),
      plan_id TEXT NOT NULL REFERENCES commission_plans(id),
      period TEXT NOT NULL,
      gross_payout REAL NOT NULL DEFAULT 0,
      multiplier_amount REAL NOT NULL DEFAULT 0,
      penalty_amount REAL NOT NULL DEFAULT 0,
      cap_adjustment REAL NOT NULL DEFAULT 0,
      split_adjustment REAL NOT NULL DEFAULT 0,
      net_payout REAL NOT NULL DEFAULT 0,
      eligibility_status TEXT NOT NULL DEFAULT 'eligible',
      eligibility_details TEXT DEFAULT '{}',
      calculation_details TEXT DEFAULT '{}',
      approval_status TEXT NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending','submitted','manager_approved','finance_approved','hr_approved','rejected','locked')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kpi_results (
      id TEXT PRIMARY KEY,
      payout_id TEXT NOT NULL REFERENCES employee_payouts(id),
      kpi_id TEXT NOT NULL REFERENCES kpi_definitions(id),
      target_value REAL NOT NULL DEFAULT 0,
      actual_value REAL NOT NULL DEFAULT 0,
      achievement_percent REAL NOT NULL DEFAULT 0,
      slab_rate REAL NOT NULL DEFAULT 0,
      slab_type TEXT,
      raw_payout REAL NOT NULL DEFAULT 0,
      weighted_payout REAL NOT NULL DEFAULT 0,
      weight REAL NOT NULL DEFAULT 0,
      calculation_details TEXT DEFAULT '{}'
    );

    -- =============================================
    -- WORKFLOW & AUDIT
    -- =============================================

    CREATE TABLE IF NOT EXISTS approval_log (
      id TEXT PRIMARY KEY,
      payout_id TEXT NOT NULL REFERENCES employee_payouts(id),
      action TEXT NOT NULL CHECK(action IN ('submitted','manager_approved','finance_approved','hr_approved','rejected','locked')),
      acted_by TEXT NOT NULL,
      acted_by_role TEXT,
      comments TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_trail (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      changes TEXT DEFAULT '{}',
      performed_by TEXT,
      performed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS simulation_snapshots (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES calculation_runs(id),
      name TEXT,
      params TEXT NOT NULL DEFAULT '{}',
      results TEXT NOT NULL DEFAULT '{}',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- =============================================
    -- §5 EVENT-BASED COMMISSION TRIGGERS
    -- =============================================

    CREATE TABLE IF NOT EXISTS commission_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      employee_id TEXT NOT NULL REFERENCES employees(id),
      reference_id TEXT,
      reference_type TEXT,
      value REAL DEFAULT 0,
      metadata TEXT DEFAULT '{}',
      event_date TEXT NOT NULL,
      period TEXT NOT NULL,
      validated INTEGER DEFAULT 0,
      validation_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- =============================================
    -- §15 PERFECT STORE COMPOSITE SCORING
    -- =============================================

    CREATE TABLE IF NOT EXISTS perfect_store_audits (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employees(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      period TEXT NOT NULL,
      assortment_score REAL DEFAULT 0,
      pricing_score REAL DEFAULT 0,
      shelf_share_score REAL DEFAULT 0,
      promotion_score REAL DEFAULT 0,
      visibility_score REAL DEFAULT 0,
      cleanliness_score REAL DEFAULT 0,
      stock_availability_score REAL DEFAULT 0,
      composite_score REAL DEFAULT 0,
      audited_by TEXT,
      audited_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS perfect_store_weights (
      id TEXT PRIMARY KEY,
      plan_id TEXT REFERENCES commission_plans(id) ON DELETE CASCADE,
      assortment_weight REAL DEFAULT 20,
      pricing_weight REAL DEFAULT 15,
      shelf_share_weight REAL DEFAULT 15,
      promotion_weight REAL DEFAULT 15,
      visibility_weight REAL DEFAULT 15,
      cleanliness_weight REAL DEFAULT 10,
      stock_availability_weight REAL DEFAULT 10
    );

    -- =============================================
    -- §22.8 ATTRIBUTE-BASED TAGGING ENGINE
    -- =============================================

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL CHECK(category IN ('product','customer','territory','employee','transaction')),
      color TEXT DEFAULT '#6366f1',
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS entity_tags (
      id TEXT PRIMARY KEY,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      valid_from TEXT,
      valid_to TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(tag_id, entity_type, entity_id)
    );

    -- =============================================
    -- §23 MULTI-CURRENCY SUPPORT
    -- =============================================

    CREATE TABLE IF NOT EXISTS currencies (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      symbol TEXT,
      is_base INTEGER DEFAULT 0,
      country TEXT
    );

    CREATE TABLE IF NOT EXISTS exchange_rates (
      id TEXT PRIMARY KEY,
      from_currency TEXT NOT NULL REFERENCES currencies(code),
      to_currency TEXT NOT NULL REFERENCES currencies(code),
      rate REAL NOT NULL,
      effective_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(from_currency, to_currency, effective_date)
    );

    -- =============================================
    -- HELPER TRIP COMMISSION (§6.3 per-drop / per-trip delivery model)
    -- Pays per completed trip; rate depends on team size (fewer helpers = more per person)
    -- =============================================

    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      trip_number TEXT,
      trip_date TEXT NOT NULL,
      trip_end_date TEXT,
      days_count INTEGER DEFAULT 1,
      period TEXT NOT NULL,
      territory_id TEXT REFERENCES territories(id),
      status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('planned','in_progress','completed','cancelled')),
      distance_km REAL DEFAULT 0,
      stops_count INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trip_participants (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL REFERENCES employees(id),
      role_on_trip TEXT DEFAULT 'helper',
      UNIQUE(trip_id, employee_id)
    );

    CREATE TABLE IF NOT EXISTS helper_trip_rates (
      id TEXT PRIMARY KEY,
      plan_id TEXT REFERENCES commission_plans(id) ON DELETE CASCADE,
      team_size INTEGER NOT NULL,
      rate_per_person REAL NOT NULL,
      currency TEXT DEFAULT 'AED',
      UNIQUE(plan_id, team_size)
    );

    -- =============================================
    -- §23 EMPLOYEE TERRITORY HISTORY (mid-month transfers)
    -- =============================================

    CREATE TABLE IF NOT EXISTS employee_territory_history (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employees(id),
      territory_id TEXT NOT NULL REFERENCES territories(id),
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      transfer_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- =============================================
    -- INDEXES
    -- =============================================

    CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(role_id);
    CREATE INDEX IF NOT EXISTS idx_employees_territory ON employees(territory_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_employee ON transactions(employee_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_period ON transactions(period);
    CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(transaction_type);
    CREATE INDEX IF NOT EXISTS idx_plan_kpis_plan ON plan_kpis(plan_id);
    CREATE INDEX IF NOT EXISTS idx_slab_tiers_set ON slab_tiers(slab_set_id);
    CREATE INDEX IF NOT EXISTS idx_rules_set ON rules(rule_set_id);
    CREATE INDEX IF NOT EXISTS idx_employee_payouts_run ON employee_payouts(run_id);
    CREATE INDEX IF NOT EXISTS idx_employee_payouts_employee ON employee_payouts(employee_id);
    CREATE INDEX IF NOT EXISTS idx_kpi_results_payout ON kpi_results(payout_id);
    CREATE INDEX IF NOT EXISTS idx_approval_log_payout ON approval_log(payout_id);
    CREATE INDEX IF NOT EXISTS idx_audit_trail_entity ON audit_trail(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_events_employee_period ON commission_events(employee_id, period);
    CREATE INDEX IF NOT EXISTS idx_events_type ON commission_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_ps_audits_employee_period ON perfect_store_audits(employee_id, period);
    CREATE INDEX IF NOT EXISTS idx_entity_tags_lookup ON entity_tags(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_entity_tags_tag ON entity_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_emp_terr_history_emp ON employee_territory_history(employee_id);
    CREATE INDEX IF NOT EXISTS idx_trips_period ON trips(period);
    CREATE INDEX IF NOT EXISTS idx_trip_participants_emp ON trip_participants(employee_id);
    CREATE INDEX IF NOT EXISTS idx_trip_participants_trip ON trip_participants(trip_id);
    CREATE INDEX IF NOT EXISTS idx_helper_rates_plan ON helper_trip_rates(plan_id);
  `);
}
