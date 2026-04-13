# Commission Management System

## Vision

A commission management platform for FMCG/bakery distribution companies (UAE, KSA, India). Allows sales managers to design incentive plans that reward salespeople for selling specific products to specific customers, with full flexibility over product and customer hierarchy scoping.

The system must handle real-world complexity: a plan might incentivize "Arabic Bread sales to Key Account Hyper Markets", or "all products to LULU group customers", or any combination of product categories, individual SKUs, customer channels, and customer groups.

## Architecture

```
Commission/
├── client/          # React + Vite + Tailwind (port 5173 dev, served by server in prod)
├── server/          # Express + better-sqlite3 (port 3001)
└── CLAUDE.md
```

**Client**: `client/src/` — React SPA with pages, components, API client
**Server**: `server/src/` — Express API with routes, calculation engine, DB layer

## Databases

### Commission DB (SQLite)
- **Path**: `server/commission.db` (auto-created on server start)
- **Schema**: `server/src/db/schema.js` — all tables defined here
- **Init**: `server/src/db/database.js` → `initDb()` creates schema, migrates, seeds KPIs, syncs from YOMI
- **IMPORTANT**: This file is in `.gitignore`. Delete it to get a fresh DB on restart.

### YOMI Source DB (SQLite, READ-ONLY)
- **Path**: `/Users/fci/Desktop/Prakash/YuamiGrowthIQ/yaumi_data.db` (1.7GB)
- **Contains**: Real UAE bakery distribution data — salesmen, customers, products, routes, warehouses, and ~82K transactions per month
- **Sync**: `server/src/db/yaumiSync.js` → `syncFromYaumi()` pulls reference data (products, customers, employees, territories) into the commission DB on every server start
- **Transaction import**: `importTransactions(db, period)` imports transactions for a given YYYY-MM period from YOMI into the commission DB
- **DO NOT** reference seed.js for data — all real data comes from YOMI. The seed.js is only for demo/sample plans and is NOT auto-run.

## Data Hierarchies

### Products (from YOMI dim_item)
- **2 levels**: Category → Individual Product (SKU)
- **11 categories**: ARABIC BREAD, SLICED BREAD, BUNS, ROLLS, CUP CAKES, POUND CAKES, PUFFS, SAMOSA, Fresh Tortilla, OTHERS, SANDWICH BREAD
- **134 products** with SKU codes like `50-4408`
- Fields: `id, name, sku, category, subcategory, unit_price, is_strategic, is_new_launch, tags`

### Customers (from YOMI dim_customer)
- **2 independent axes**:
  - **Channel** (sales_class): KH=Key Account Hyper Market, KS=Key Account Super Market, LG=Large Groceries, MG=Mini Groceries, SG=Small Groceries, HO=Fast Foods, EC=E-Commerce, MM=Mini Market, PH=Pharmacy, PS=Petrol Station, etc.
  - **Customer Group**: LULU, DUBCRD, DUBKEY, EMARAT, CAREEM, AMAZONAE, etc.
- Fields: `id, name, channel, channel_name, customer_group, customer_group_name, territory_id`

### Territories (from YOMI)
- **3 levels**: National (UAE) → Region (Depot/Warehouse) → Area (Route)
- 2 depots: DXB P1, ABU DHABI
- 12 routes

### Employees (from YOMI dim_salesman)
- All mapped as `role-salesman` by default
- Each assigned to their primary route based on transaction frequency

## Calculation Engine

**Pipeline**: `server/src/engine/calculationPipeline.js`

13-step pipeline per employee:
1. **Fetch Transactions** — all transactions for employee+period (with product/customer joins)
2. **Apply Mapping Filters** — plan-level Include/Exclude rules filter transactions
3. **Eligibility Check** — min sales, min collection %, etc.
4. **KPI Achievement** — formula evaluator computes actual values per KPI
5. **Determine Slab** — match achievement % to slab tier
6. **KPI Payout** — base_payout × slab_rate
7. **Apply Weight** — multiply by KPI weight %
8. **Aggregate KPIs** — sum all KPI payouts into gross
9. **Apply Multiplier** — growth bonuses, strategic SKU bonuses
10. **Apply Penalty** — return %, late delivery penalties
11. **Apply Cap** — max payout limits
12. **Store Payout** — persist to employee_payouts + kpi_results
13. **Create Approval** — approval workflow entry

### Two Filtering Layers

1. **Plan-level (Include/Exclude rules)**: Filters ALL transactions for the plan. Configured in the "Product & Customer Scope" tab. Stored in `rule_sets` + `rules` tables. Applied in step 2.

2. **KPI-level (Formula filters)**: Filters transactions for a SPECIFIC KPI. Configured inside the KPI formula (FormulaBuilder). For example, a "Strategic SKU Revenue" KPI filters `is_strategic=1`. Applied in step 4 via `formulaEvaluator.js`.

### Formula Evaluator
- **File**: `server/src/engine/formulaEvaluator.js`
- Evaluates structured JSON formulas stored in `kpi_definitions.formula`
- 5 types: simple, ratio, growth, team, static
- Filter fields: `is_strategic, is_new_launch, product_category, product_sku, customer_channel, customer_group`

## Key Decisions

- **Dates**: DD/MM/YYYY format (UAE/KSA/India markets). Utility functions in `client/src/lib/utils.js`.
- **Currency**: AED. Formatted via `formatCurrency()` in utils.js.
- **Slab types**: step (flat rate per tier), progressive (proportional), accelerator (base + accelerated above 100%).
- **Territory hierarchy in calculations**: When a plan targets "UAE" (national), all employees in descendant territories (depots, routes) are included. Hierarchy expansion happens in `calculationPipeline.js`.

## Server Startup

```bash
cd server && node src/index.js
```

On start:
1. Creates/opens `commission.db`
2. Runs `createSchema()` — creates all tables if not exist
3. Runs `migrateCustomerColumns()` — adds new columns idempotently
4. Runs `seedKpisIfEmpty()` — seeds 15 KPI definitions if table is empty
5. Runs `migrateFormulas()` — converts legacy text formulas to structured JSON
6. Runs `syncFromYaumi()` — syncs products, customers, employees, territories from YOMI

## Client Dev

```bash
cd client && npm run dev
```

Vite dev server on port 5173 with proxy `/api` → `http://localhost:3001`.

## Deployment

- **Railway API Key**: Stored in `server/.env` (RAILWAY_API_KEY=9cbd5533-1584-4822-8ce4-aec04cdfb806)
- **Production build**: `cd client && npm run build` → `client/dist/`
- **Server serves static files**: `server/src/index.js` serves `client/dist/` for non-API routes
- **PORT**: Uses `process.env.PORT || 3001`
- **YOMI DB on Railway**: Won't be available. Server handles this gracefully — `syncFromYaumi()` silently skips if YOMI DB not found. KPIs are seeded from `seedKpisIfEmpty()`. Products/customers/employees need to be pre-populated or imported via API.

## Testing

Always test with YOMI data:
1. Start server (auto-syncs from YOMI)
2. Import transactions: `POST /api/calculation/import-transactions` with `{"period":"2024-01"}`
3. Create plan via UI or API
4. Run calculation: `POST /api/calculation/run` with `{"plan_id":"...","period":"2024-01"}`
5. Verify results against direct SQL on commission.db

## Common Gotchas

- **Empty KPI dropdown**: If `kpi_definitions` table is empty, `seedKpisIfEmpty()` in database.js should auto-populate. If it doesn't, check server startup logs.
- **Slab not applied (AED 0)**: `plan_kpis.slab_set_id` may be NULL. Pipeline has fallback to look up `slab_sets` by `plan_id + kpi_id`.
- **Everyone gets same commission**: Expected with step slabs — all employees in same tier get same rate. Use progressive slabs for proportional payouts.
- **Schema changes**: After modifying `schema.js`, delete `commission.db` and restart. The DB auto-recreates.
- **YOMI sync path**: Hardcoded in `yaumiSync.js` as `../../../../YuamiGrowthIQ/yaumi_data.db` relative to the file.
