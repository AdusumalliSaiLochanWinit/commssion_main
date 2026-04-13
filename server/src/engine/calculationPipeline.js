import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';
import { fetchScopedTransactions } from './step01_fetchTransactions.js';
import { applyMappingFilters, buildTagContext } from './step02_mappingFilters.js';
import { calculateKpiAchievement } from './step03_kpiAchievement.js';
import { determineSlab } from './step04_determineSlab.js';
import { calculateKpiPayout } from './step05_kpiPayout.js';
import { applyWeight } from './step06_applyWeight.js';
import { aggregateKpis } from './step07_aggregateKpis.js';
import { applyMultiplier } from './step08_applyMultiplier.js';
import { applyPenalty } from './step09_applyPenalty.js';
import { applyCap } from './step10_applyCap.js';
import { storePayout } from './step11_storePayout.js';
import { createApproval } from './step12_createApproval.js';
import { checkEligibility } from './eligibilityEngine.js';

export async function runCalculationPipeline({ plan_id, period, created_by, is_simulation = false, overrides = {}, employee_id = null }) {
  const db = getDb();
  const startTime = Date.now();

  // Load plan configuration
  const plan = await db.prepare('SELECT * FROM commission_plans WHERE id = ?').get(plan_id);
  if (!plan) throw new Error('Plan not found');

  // Create calculation run
  const runId = uuid();
  await db.prepare(`
    INSERT INTO calculation_runs (id, plan_id, period, status, is_simulation, simulation_params, created_by)
    VALUES (?, ?, ?, 'running', ?, ?, ?)
  `).run(runId, plan_id, period, is_simulation ? 1 : 0, JSON.stringify(overrides), created_by);

  const steps = [];
  const log = (stepNum, name, detail) => {
    steps.push({ step: stepNum, name, ...detail, timestamp: Date.now() - startTime });
  };

  try {
    // Get eligible employees for this plan
    const planRoles = (await db.prepare('SELECT role_id FROM plan_roles WHERE plan_id = ?').all(plan_id)).map(r => r.role_id);
    const planTerritories = (await db.prepare('SELECT territory_id FROM plan_territories WHERE plan_id = ?').all(plan_id)).map(t => t.territory_id);

    const employees = await db.prepare(`
      SELECT e.*, r.name as role_name FROM employees e
      JOIN roles r ON e.role_id = r.id
      WHERE e.is_active = 1 AND e.role_id IN (${planRoles.map(() => '?').join(',')})
    `).all(...planRoles);

    // Filter by territory if specified (with hierarchy: include all descendants)
    let filteredEmployees;
    if (planTerritories.length > 0) {
      const allTerritories = new Set(planTerritories);
      const allTerrRows = await db.prepare('SELECT id, parent_id FROM territories').all();
      let changed = true;
      while (changed) {
        changed = false;
        for (const t of allTerrRows) {
          if (!allTerritories.has(t.id) && t.parent_id && allTerritories.has(t.parent_id)) {
            allTerritories.add(t.id);
            changed = true;
          }
        }
      }
      filteredEmployees = employees.filter(e => allTerritories.has(e.territory_id));
    } else {
      filteredEmployees = employees;
    }

    if (employee_id) {
      filteredEmployees = filteredEmployees.filter(e => e.id === employee_id);
    }

    log(0, 'Initialize', { employee_count: filteredEmployees.length, plan: plan.name });

    // Load plan KPIs
    const planKpis = await db.prepare(`
      SELECT pk.*, k.name as kpi_name, k.code as kpi_code, k.formula, k.unit, k.direction, k.category as kpi_category
      FROM plan_kpis pk JOIN kpi_definitions k ON pk.kpi_id = k.id
      WHERE pk.plan_id = ?
    `).all(plan_id);

    // Load rules
    const ruleSets = await db.prepare('SELECT * FROM rule_sets WHERE plan_id = ?').all(plan_id);
    for (const rs of ruleSets) {
      rs.rules = await db.prepare('SELECT * FROM rules WHERE rule_set_id = ?').all(rs.id);
    }

    // Build tag context once for the whole run (§22.8 tag-based rules)
    let tagContext = null;
    try {
      tagContext = await buildTagContext(db);
    } catch {
      tagContext = { productTags: {}, customerTags: {}, territoryTags: {} };
    }

    // As-of date for time-bound rule evaluation — use end of period
    const asOfDate = period.includes('-')
      ? `${period.slice(0, 7)}-28`
      : new Date().toISOString().split('T')[0];
    const eligibilityRules = await db.prepare('SELECT * FROM eligibility_rules WHERE plan_id = ? AND is_active = 1').all(plan_id);
    const multiplierRules = await db.prepare('SELECT * FROM multiplier_rules WHERE plan_id = ? AND is_active = 1').all(plan_id);
    const penaltyRules = await db.prepare('SELECT * FROM penalty_rules WHERE plan_id = ? AND is_active = 1').all(plan_id);
    const cappingRules = await db.prepare('SELECT * FROM capping_rules WHERE plan_id = ? AND is_active = 1').all(plan_id);
    const splitRules = await db.prepare('SELECT * FROM split_rules WHERE plan_id = ? AND is_active = 1').all(plan_id);
    for (const sr of splitRules) {
      sr.participants = await db.prepare('SELECT * FROM split_participants WHERE split_rule_id = ?').all(sr.id);
    }

    // Load slab config
    const slabSets = {};
    for (const pk of planKpis) {
      let ss = null;
      if (pk.slab_set_id) {
        ss = await db.prepare('SELECT * FROM slab_sets WHERE id = ?').get(pk.slab_set_id);
      }
      if (!ss) {
        ss = await db.prepare('SELECT * FROM slab_sets WHERE plan_id = ? AND kpi_id = ?').get(plan.id, pk.kpi_id);
      }
      if (ss) {
        ss.tiers = await db.prepare('SELECT * FROM slab_tiers WHERE slab_set_id = ? ORDER BY tier_order').all(ss.id);
        slabSets[pk.kpi_id] = ss;
      }
    }

    const allPayouts = [];

    for (const employee of filteredEmployees) {
      const empContext = {
        employee,
        plan,
        period,
        overrides,
        basePayout: overrides.base_payout ?? plan.base_payout,
      };

      // Step 1: Fetch scoped transactions
      const transactions = await fetchScopedTransactions(db, employee.id, period, employee.territory_id);
      log(1, 'Fetch Transactions', { employee: employee.name, count: transactions.length });

      // Step 2: Apply mapping filters (include/exclude + tags + time-bound + conditional)
      const filtered = applyMappingFilters(db, transactions, ruleSets, tagContext, asOfDate);
      const excludedCount = transactions.length - filtered.length;
      log(2, 'Apply Mapping Filters', {
        employee: employee.name,
        before: transactions.length,
        after: filtered.length,
        excluded: excludedCount,
        events_included: transactions.filter(t => t._event_source).length,
      });

      // Eligibility check
      const eligibility = checkEligibility(filtered, eligibilityRules, empContext);
      log(2.5, 'Eligibility Check', { employee: employee.name, status: eligibility.status, details: eligibility.details });

      const kpiResults = [];

      for (const planKpi of planKpis) {
        const targetValue = overrides.targets?.[planKpi.kpi_id] ?? planKpi.target_value;

        // Step 3: Calculate KPI achievement
        const achievement = await calculateKpiAchievement(filtered, planKpi, employee, period, db, targetValue !== planKpi.target_value ? targetValue : undefined);
        log(3, 'KPI Achievement', { employee: employee.name, kpi: planKpi.kpi_name, actual: achievement.actual, target: targetValue, percent: achievement.percent });

        // Step 4: Determine slab
        const slabSet = slabSets[planKpi.kpi_id];
        const slabResult = determineSlab(achievement.percent, slabSet, overrides.slabs?.[planKpi.kpi_id]);
        log(4, 'Determine Slab', { employee: employee.name, kpi: planKpi.kpi_name, slab_type: slabResult.type, rate: slabResult.rate });

        // Step 5: Calculate KPI payout
        const kpiPayout = calculateKpiPayout(achievement, slabResult, empContext);
        log(5, 'KPI Payout', { employee: employee.name, kpi: planKpi.kpi_name, raw_payout: kpiPayout.amount });

        // Step 6: Apply weight
        const weighted = applyWeight(kpiPayout.amount, planKpi.weight);
        log(6, 'Apply Weight', { employee: employee.name, kpi: planKpi.kpi_name, weight: planKpi.weight, weighted_payout: weighted });

        kpiResults.push({
          kpi_id: planKpi.kpi_id,
          kpi_name: planKpi.kpi_name,
          kpi_code: planKpi.kpi_code,
          kpi_category: planKpi.kpi_category,
          unit: planKpi.unit,
          target_value: targetValue,
          actual_value: achievement.actual,
          achievement_percent: achievement.percent,
          slab_rate: slabResult.rate,
          slab_type: slabResult.type,
          raw_payout: kpiPayout.amount,
          weighted_payout: weighted,
          weight: planKpi.weight,
          calculation_details: JSON.stringify({
            achievement,
            slab: slabResult,
            payout: kpiPayout,
          }),
        });
      }

      // Step 7: Aggregate KPIs
      let grossPayout = aggregateKpis(kpiResults);

      // §6.3 Helper Trip Commission — added to gross before multipliers
      // Pays per-trip based on team size (fewer participants = higher per-person rate)
      let helperTripAmount = 0;
      let helperTripDetails = null;
      try {
        let tiers = await db.prepare('SELECT team_size, rate_per_person FROM helper_trip_rates WHERE plan_id = ?').all(plan_id);
        if (tiers.length === 0) {
          tiers = await db.prepare('SELECT team_size, rate_per_person FROM helper_trip_rates WHERE plan_id IS NULL').all();
        }
        if (tiers.length > 0) {
          tiers.sort((a, b) => a.team_size - b.team_size);
          const getRate = (size) => {
            let rate = 0;
            for (const t of tiers) if (t.team_size <= size) rate = t.rate_per_person;
            return rate;
          };
          const empTrips = await db.prepare(`
            SELECT t.id, t.trip_number, t.trip_date, t.trip_end_date, t.days_count,
                   (SELECT COUNT(*) FROM trip_participants tp2 WHERE tp2.trip_id = t.id) as team_size
            FROM trips t
            JOIN trip_participants tp ON tp.trip_id = t.id
            WHERE tp.employee_id = ? AND t.period = ? AND t.status = 'completed'
          `).all(employee.id, period);

          // Helper: compute days (inclusive) if days_count isn't persisted
          const daysOf = (t) => {
            if (t.days_count && t.days_count > 0) return t.days_count;
            if (!t.trip_end_date || t.trip_end_date === t.trip_date) return 1;
            const diff = Math.round((new Date(t.trip_end_date) - new Date(t.trip_date)) / 86400000) + 1;
            return Math.max(1, diff);
          };

          helperTripAmount = empTrips.reduce((sum, t) => sum + getRate(t.team_size) * daysOf(t), 0);
          const totalDays = empTrips.reduce((sum, t) => sum + daysOf(t), 0);
          helperTripDetails = {
            trip_count: empTrips.length,
            total_days: totalDays,
            solo: empTrips.filter(t => t.team_size === 1).length,
            paired: empTrips.filter(t => t.team_size === 2).length,
            team: empTrips.filter(t => t.team_size >= 3).length,
            total: helperTripAmount,
          };
          grossPayout += helperTripAmount;
        }
      } catch (e) { /* table may not exist yet on old DBs */ }

      log(7, 'Aggregate KPIs', {
        employee: employee.name,
        gross_payout: grossPayout,
        helper_trip_bonus: helperTripAmount,
        trips: helperTripDetails,
      });

      // Step 8: Apply multiplier
      const multiplierResult = await applyMultiplier(grossPayout, multiplierRules, filtered, employee, period, db, overrides.multipliers);
      log(8, 'Apply Multiplier', { employee: employee.name, multiplier_amount: multiplierResult.amount, applied: multiplierResult.applied });

      // Step 9: Apply penalty
      const penaltyResult = applyPenalty(grossPayout + multiplierResult.amount, penaltyRules, filtered);
      log(9, 'Apply Penalty', { employee: employee.name, penalty_amount: penaltyResult.amount, triggered: penaltyResult.triggered });

      let netPayout = grossPayout + multiplierResult.amount - penaltyResult.amount;

      if (eligibility.status === 'ineligible') {
        netPayout = 0;
      } else if (eligibility.status === 'reduced') {
        netPayout = netPayout * (1 - eligibility.reduction / 100);
      }

      // Step 10: Apply cap
      const capResult = applyCap(netPayout, cappingRules, employee);
      log(10, 'Apply Cap', { employee: employee.name, before: netPayout, after: capResult.capped, cap_hit: capResult.applied });

      netPayout = capResult.capped;

      let splitAdjustment = 0;
      if (splitRules.length > 0) {
        for (const sr of splitRules) {
          const participant = sr.participants.find(p => p.role_id === employee.role_id);
          if (participant) {
            splitAdjustment = netPayout - (netPayout * participant.split_percent / 100);
            netPayout = netPayout * participant.split_percent / 100;
          }
        }
      }

      const payoutRecord = {
        employee,
        run_id: runId,
        gross_payout: grossPayout,
        multiplier_amount: multiplierResult.amount,
        penalty_amount: penaltyResult.amount,
        cap_adjustment: capResult.adjustment,
        split_adjustment: splitAdjustment,
        net_payout: Math.round(netPayout * 100) / 100,
        eligibility_status: eligibility.status,
        eligibility_details: eligibility.details,
        kpi_results: kpiResults,
        calculation_details: {
          multiplier: multiplierResult,
          penalty: penaltyResult,
          cap: capResult,
          eligibility,
          helper_trips: helperTripDetails,    // §6.3 helper trip bonus breakdown
          helper_trip_bonus: helperTripAmount,
          kpi_gross_only: grossPayout - helperTripAmount, // pure KPI gross before helper addition
        },
      };

      // Step 11: Store payout
      const payoutId = await storePayout(db, payoutRecord, plan_id, period);
      log(11, 'Store Payout', { employee: employee.name, payout_id: payoutId, net_payout: payoutRecord.net_payout });

      // Step 12: Create approval entry (only for real runs)
      if (!is_simulation) {
        await createApproval(db, payoutId);
        log(12, 'Create Approval', { employee: employee.name, status: 'submitted' });
      }

      allPayouts.push({ ...payoutRecord, id: payoutId });
    }

    // Step 13: Complete the run
    const totalPayout = allPayouts.reduce((sum, p) => sum + p.net_payout, 0);
    await db.prepare(`
      UPDATE calculation_runs SET status = 'completed', total_payout = ?, employee_count = ?,
        completed_at = datetime('now'), calculation_details = ?
      WHERE id = ?
    `).run(Math.round(totalPayout * 100) / 100, allPayouts.length, JSON.stringify({ steps }), runId);
    log(13, 'Complete', { total_payout: totalPayout, employee_count: allPayouts.length });

    return {
      run_id: runId,
      plan_id,
      period,
      status: 'completed',
      is_simulation,
      total_payout: Math.round(totalPayout * 100) / 100,
      employee_count: allPayouts.length,
      payouts: allPayouts.map(p => ({
        employee_id: p.employee.id,
        employee_name: p.employee.name,
        role_name: p.employee.role_name,
        gross_payout: p.gross_payout,
        net_payout: p.net_payout,
        eligibility_status: p.eligibility_status,
      })),
      steps,
    };
  } catch (err) {
    await db.prepare("UPDATE calculation_runs SET status = 'failed', completed_at = datetime('now') WHERE id = ?").run(runId);
    throw err;
  }
}
