# Commission Management System — Current State

## Status: Testing COMPLETE, Ready for Railway Deployment

All tests pass. Full results in `/Users/fci/Desktop/Prakash/Commission/TEST_RESULTS.md`.

## Key Paths
- **Server**: `/Users/fci/Desktop/Prakash/Commission/server/` (Express, port 3001)
- **Client**: `/Users/fci/Desktop/Prakash/Commission/client/` (React+Vite, port 5173 dev)
- **Commission DB**: `/Users/fci/Desktop/Prakash/Commission/server/commission.db` (auto-created)
- **YOMI Source DB**: `/Users/fci/Desktop/Prakash/YuamiGrowthIQ/yaumi_data.db` (1.7GB, READ-ONLY)
- **Railway config**: `/Users/fci/Desktop/Prakash/Commission/railway.json`
- **Client build**: `/Users/fci/Desktop/Prakash/Commission/client/dist/` (built 25/02/2026)

## Active Plans in DB
1. **Arabic Bread Sales Incentive** (`9d1f51f8-...`) — Product scope: ARABIC BREAD, target 3000, UAE territory
2. **LULU Key Account Incentive** (`39962ad1-...`) — Customer scope: LULU group, target 15000, UAE territory

## DB Stats (period 2026-01)
15 KPIs, 68 employees, 134 products, 1231 customers, 15 territories, 8 roles, 81,688 transactions

## API Endpoints (see CLAUDE.md for full list)
- Lookups now support territory filtering: `?territories=terr-1,terr-2`
- Slab tiers use `min_percent`/`max_percent` (NOT min_value/max_value)

## Key Code Files Changed Across Sessions

| File | What Changed |
|------|-------------|
| `server/src/db/database.js` | `seedKpisIfEmpty()` — auto-seeds 15 KPIs on fresh DB |
| `server/src/db/schema.js` | `customer_group` in rules dimension CHECK constraint |
| `server/src/db/yaumiSync.js` | channel_name, customer_group, customer_group_name in customer sync |
| `server/src/engine/step02_mappingFilters.js` | `customer_group` case in switch |
| `server/src/engine/formulaEvaluator.js` | Extended VALID_FILTER_FIELDS with product_sku, customer_group |
| `server/src/engine/step01_fetchTransactions.js` | customer_group to SQL joins |
| `server/src/engine/calculationPipeline.js` | Territory hierarchy expansion |
| `server/src/routes/lookups.js` | `expandTerritories()` helper, territory-filtered customer lookups |
| `server/src/index.js` | PORT env, static serving, SPA fallback, 0.0.0.0 bind |
| `client/src/pages/PlanBuilderPage.jsx` | RulesTab with ScopePicker, territory-filtered customer lookups |
| `client/src/components/FormulaBuilder.jsx` | FilterValueInput with dynamic lookups |

## Railway Deployment
Root `package.json` has build/start scripts. `railway.json` uses Nixpacks, start: `cd server && node src/index.js`. YOMI DB not available on Railway — server handles gracefully.

## User Preferences
- UAE/KSA/India market — dates DD/MM/YYYY, currency AED
- All data from YOMI database, NOT seed.js
- Visual pickers (checkboxes, search), NOT free-text inputs
- Autonomous work preferred — minimize questions
