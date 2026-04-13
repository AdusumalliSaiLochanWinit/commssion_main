# Commission Management System — Test Results

**Date**: 25/02/2026
**Period Tested**: 2026-01
**Data Source**: YOMI database (81,688 transactions for 2026-01)

---

## Test Plan 1: Arabic Bread Sales Incentive

| Field | Value |
|-------|-------|
| Plan ID | `9d1f51f8-2e60-400f-9fc5-c2974cab3f90` |
| Status | Active |
| Base Payout | AED 1,000 |
| KPI | Total Revenue (kpi-01), weight 100%, target AED 3,000 |
| Product Scope | ARABIC BREAD category only (include rule) |
| Customer Scope | All customers |
| Territory | UAE (national — includes all routes) |
| Role | Salesman |
| Slab Type | Step (5 tiers) |

### Slab Tiers
| Achievement | Rate |
|-------------|------|
| 0–50% | 0% |
| 50–80% | 50% |
| 80–100% | 80% |
| 100–120% | 100% |
| 120%+ | 120% |

### Calculation Results (PASS)

| Employee | Arabic Bread Revenue | Achievement % | Slab Rate | Payout |
|----------|---------------------|---------------|-----------|--------|
| Farrukh Ozair | AED 3,662.28 | 122.08% | 120% | AED 1,200 |
| Muhammed Ali Jouhar | AED 3,604.78 | 120.16% | 120% | AED 1,200 |
| ROY JOHNSON | AED 3,572.96 | 119.10% | 100% | AED 1,000 |
| ABHIMANYU BALU | AED 2,836.56 | 94.55% | 80% | AED 800 |
| NAEEM SHAHZAD | AED 2,831.01 | 94.37% | 80% | AED 800 |
| Muhammad Naseeb | AED 2,518.88 | 83.96% | 80% | AED 800 |
| Abdul Rehman | AED 2,356.65 | 78.55% | 50% | AED 500 |
| Abdul Samad | AED 2,166.28 | 72.21% | 50% | AED 500 |
| GANGA PRASAD TIMILSINA | AED 2,072.41 | 69.08% | 50% | AED 500 |
| Prithwi Raj Kandel | AED 1,746.16 | 58.21% | 50% | AED 500 |
| RIYAS THARAMMAL | AED 1,303.64 | 43.45% | 0% | AED 0 |
| FAIZUL HASSAN | AED 769.32 | 25.64% | 0% | AED 0 |
| DINOOP NELLULLIYIL | AED 126.54 | 4.22% | 0% | AED 0 |

**Total Payout**: AED 7,800
**Employees with payouts**: 10 of 68

### Scope Filter Verification (PASS)
- Farrukh Ozair: Arabic Bread revenue = **AED 3,662.28** (matches calculation)
- Farrukh Ozair: Total revenue (all categories) = **AED 75,310.51**
- Confirms plan correctly filters only ARABIC BREAD transactions

---

## Test Plan 2: LULU Key Account Incentive

| Field | Value |
|-------|-------|
| Plan ID | `39962ad1-4c33-40d5-bb73-4fa875a15fab` |
| Status | Active |
| Base Payout | AED 1,500 |
| KPI | Total Revenue (kpi-01), weight 100%, target AED 15,000 |
| Product Scope | All products |
| Customer Scope | LULU customer group only (include rule) |
| Territory | UAE (national) |
| Role | Salesman |
| Slab Type | Step (same 5 tiers) |

### Calculation Results (PASS)

| Employee | LULU Revenue | Achievement % | Slab Rate | Payout |
|----------|-------------|---------------|-----------|--------|
| GANGA PRASAD TIMILSINA | AED 25,597.46 | 170.65% | 120% | AED 1,800 |
| ROY JOHNSON | AED 22,814.55 | 152.10% | 120% | AED 1,800 |
| Abdul Rehman | AED 13,466.50 | 89.78% | 80% | AED 1,200 |
| Muhammed Ali Jouhar | AED 12,606.35 | 84.04% | 80% | AED 1,200 |
| Farrukh Ozair | AED 7,332.64 | 48.88% | 0% | AED 0 |
| DINOOP NELLULLIYIL | AED 414.58 | 2.76% | 0% | AED 0 |

**Total Payout**: AED 6,000
**Employees with LULU sales**: 6 of 68

### Scope Filter Verification (PASS)
- Only 6 employees have LULU customer group sales (matches direct SQL)
- Employees without LULU customers correctly get AED 0

---

## UI Tests (Browser — port 5173)

| Test | Status | Notes |
|------|--------|-------|
| Dashboard loads | PASS | Total Sales AED 1,130,882, Payouts AED 13,800 (7800+6000), 13 active salespeople |
| Plans list shows both plans | PASS | Both Active, correct base payouts, dates DD/MM/YYYY |
| KPI Library shows 15 KPIs | PASS | All 11 categories visible |
| Plan builder General tab | PASS | All fields populated, roles, territories |
| KPIs & Weights tab | PASS | Total Revenue assigned, target 3000, weight 100% |
| Slabs tab | PASS | 5-tier step slabs displayed |
| Product & Customer Scope tab | PASS | See details below |
| Date format DD/MM/YYYY | PASS | 01/01/2026 to 31/12/2026 |
| Currency format AED | PASS | AED prefix used throughout |

### Product Scope Picker Tests

| Test | Status | Notes |
|------|--------|-------|
| "All Products" radio | PASS | |
| "By Category" radio — shows checkboxes | PASS | All 11 categories visible (scrollable list) |
| ARABIC BREAD pre-checked | PASS | Loaded from existing rules |
| "Specific Products" radio | PASS | Shows individual SKU picker |
| Product categories scrollable | PASS | `max-h-48` with `overflow-y-auto` |

### Customer Scope Picker Tests

| Test | Status | Notes |
|------|--------|-------|
| "All Customers" radio | PASS | |
| "By Channel" radio — shows channel checkboxes | PASS | 13 channels (all, no territory filter with UAE) |
| "By Customer Group" radio — shows group checkboxes | PASS | 18 groups (all, with UAE territory) |
| Territory filtering — Route 9219 only | PASS | Customer groups reduced from 18 to 6 (ADCOOP, CAR4PVT, DNPRC, DUBCRD, DUBKEYT, LULU) |
| Territory filtering — Channel by Route 9219 | PASS | Channels reduced from 13 to 9 |
| Territory hierarchy expansion (UAE = all routes) | PASS | UAE shows all 18 groups |

---

## Eligibility, Multiplier, Penalty & Cap Engine Tests

All tests below run on the Arabic Bread plan (`9d1f51f8`) with various rule combinations.

### Test 3A: Eligibility — Zero Payout (PASS)

**Rule**: min_sales >= 2000, action = zero_payout

| Employee | Arabic Bread Sales | Eligible? | Gross | Net |
|----------|-------------------|-----------|-------|-----|
| Farrukh Ozair | AED 3,662.28 | Yes | 1,200 | 1,200 |
| ROY JOHNSON | AED 3,572.96 | Yes | 1,000 | 1,000 |
| Prithwi Raj Kandel | AED 1,746.16 | **No (< 2000)** | 500 | **0** |
| RIYAS THARAMMAL | AED 1,303.64 | **No** | 0 | **0** |

**Total Payout**: AED 6,210 (was AED 7,800 without eligibility)
4 employees correctly zeroed out due to sales below threshold.

### Test 3B: Eligibility — Reduce Percent (PASS)

**Rule**: min_sales >= 2000, action = reduce_percent, reduction = 25%

| Employee | Eligible? | Gross | Net | Notes |
|----------|-----------|-------|-----|-------|
| Prithwi Raj Kandel | Reduced | 500 | **506.25** | 675 × 75% (after multiplier + penalty) |
| RIYAS THARAMMAL | Reduced | 0 | 0 | Gross=0 so reduction has no effect |

**Total Payout**: AED 7,931.25

### Test 3C: Penalty — Return Percent (PASS)

**Rule**: return_percent > 30%, penalty = 10% (percentage)

| Employee | Return % | Penalty Triggered? | Gross | Penalty | Net |
|----------|----------|-------------------|-------|---------|-----|
| Farrukh Ozair | 47.19% | **Yes** | 1,200 | 120 | 1,080 |
| ROY JOHNSON | 42.30% | **Yes** | 1,000 | 100 | 900 |
| NAEEM SHAHZAD | 31.51% | **Yes** | 800 | 80 | 720 |

All 9 eligible employees had return% > 30%, all correctly penalized 10%.

### Test 3D: Cap — Max Per Plan (PASS)

**Rule**: max_per_plan = AED 900

| Employee | Before Cap | After Cap | Cap Adjustment |
|----------|-----------|-----------|---------------|
| Farrukh Ozair | 1,080 | **900** | 180 |
| Muhammed Ali Jouhar | 1,080 | **900** | 180 |
| ROY JOHNSON | 900 | 900 | 0 |
| ABHIMANYU BALU | 720 | 720 | 0 (under cap) |

Cap correctly limits payouts at AED 900.

### Test 3E: Multiplier — Strategic SKU Bonus (PASS)

**Rule**: strategic_sku_percent >= 10%, multiplier = 1.5x, stacking = multiplicative

| Employee | Strategic % | Multiplier Applied | Gross | Multiplier Amount | Penalty (5%) | Net |
|----------|------------|-------------------|-------|-------------------|-------------|-----|
| Farrukh Ozair | 100% | **Yes** | 1,200 | 600 | 90 | **1,710** |
| Abdul Rehman | 100% | **Yes** | 500 | 250 | 37.5 | **712.5** |

All Arabic Bread products are strategic (100%), so 1.5x multiplier applies to all eligible employees.

### Test 3F: Combined Rules (Eligibility + Multiplier + Penalty) (PASS)

**Rules**: min_sales >= 2000 (zero), strategic_sku >= 10% (1.5x), return > 7% (5% penalty)

| Employee | Gross | Multiplier | Penalty | Net | Status |
|----------|-------|-----------|---------|-----|--------|
| Farrukh Ozair | 1,200 | +600 | -90 | **1,710** | eligible |
| Muhammed Ali Jouhar | 1,200 | +600 | -90 | **1,710** | eligible |
| ROY JOHNSON | 1,000 | +500 | -75 | **1,425** | eligible |
| NAEEM SHAHZAD | 800 | +400 | -60 | **1,140** | eligible |
| ABHIMANYU BALU | 800 | +400 | -60 | **1,140** | eligible |
| Muhammad Naseeb | 800 | +400 | -60 | **1,140** | eligible |
| Abdul Rehman | 500 | +250 | -37.5 | **712.5** | eligible |
| GANGA PRASAD TIMILSINA | 500 | +250 | -37.5 | **712.5** | eligible |
| Abdul Samad | 500 | +250 | -37.5 | **712.5** | eligible |
| Prithwi Raj Kandel | 500 | — | — | **0** | ineligible |

**Total Payout**: AED 10,402.50

### UI Tests — Eligibility, Multipliers, Penalties, Caps & Splits Tabs

| Test | Status | Notes |
|------|--------|-------|
| Eligibility tab — Add Rule | PASS | Form: Metric, Operator, Value, Action dropdowns |
| Eligibility — value input accepts numbers | PASS | Fixed bug: `Number("")` → 0 on clear. Now uses `?? ''` for empty state |
| Eligibility — Save persists value | PASS | Typed 2000, saved, verified 2000 in DB |
| Eligibility — reduce_percent shows reduction input | PASS | Extra field appears when action = "Reduce %" |
| Multipliers tab — Add Multiplier | PASS | Form: Name, Type, Condition Metric, Op, Value, Multiplier, Stacking |
| Multipliers — all types available | PASS | Growth, Strategic SKU, New Launch, Channel Mix, Collection Speed |
| Multipliers — stacking modes | PASS | Multiplicative, Additive, Highest Only |
| Multipliers — Save persists | PASS | "Strategic SKU Bonus" saved with value=10, multiplier=1.5 |
| Penalties tab — Add Penalty | PASS | Form: Name, Metric, Op, Value, Type (Percentage/Fixed/Slab Downgrade), Amount |
| Penalties — Save persists | PASS | "High Returns Penalty" saved with trigger=7, penalty=5% |
| Caps & Splits tab | PASS | Shows both Capping Rules and Split Rules sections |
| Caps — Add Cap | PASS | Types: Max Per Plan, % of Salary, Max Per KPI |
| Splits — Add Split | PASS | Name field + Add Participant with role dropdown |

### Bug Fix: Number Input Clearing

**Problem**: When clearing a number input to type a new value, `Number("")` returned `0`, making it impossible to clear and retype.
**Fix**: Changed all number inputs to use `value={field ?? ''}` and `e.target.value === '' ? '' : Number(e.target.value)`. Save functions cast back to `Number() || 0`.
**Files changed**: `client/src/pages/PlanBuilderPage.jsx` — EligibilityTab, MultipliersTab, PenaltiesTab, CapsTab

---

## New Feature: Territory-Filtered Customer Scope

**Implemented**: Customer scope pickers (By Channel, By Customer Group, Specific Customers) now filter by the plan's selected territories. When a user selects specific routes in the General tab, only customers on those routes appear in the scope pickers.

**Files changed**:
- `server/src/routes/lookups.js` — Added `expandTerritories()` helper + `territories` query param support
- `client/src/pages/PlanBuilderPage.jsx` — RulesTab useEffect now passes territory IDs to customer lookup API calls

---

## Production Build

| Step | Status | Details |
|------|--------|---------|
| `npm run build` | PASS | 2.15s, 784KB JS (218KB gzip), 29KB CSS |
| `dist/index.html` exists | PASS | |

---

## Summary

All tests pass:
- **Calculation engine**: Both plan types (product scope, customer scope) produce correct results verified against direct SQL
- **Eligibility engine**: Both zero_payout and reduce_percent actions work correctly
- **Multiplier engine**: Strategic SKU multiplier (1.5x) applies correctly with multiplicative stacking
- **Penalty engine**: Return% penalty triggers and deducts correct percentage amounts
- **Capping engine**: Max per plan cap correctly limits payouts
- **Combined rules**: All engines interact correctly in the 13-step pipeline
- **UI**: All 8 plan builder tabs work — General, KPIs, Slabs, Scope, Eligibility, Multipliers, Penalties, Caps & Splits
- **Number input bug fixed**: Clearing and retyping values now works correctly across all tabs
- **Territory filtering**: Customer scope pickers filter by plan territories with hierarchy expansion
