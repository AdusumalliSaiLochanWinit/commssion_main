import { Router } from 'express';
import { getDb } from '../db/database.js';

const router = Router();

// Salesperson dashboard
router.get('/salesperson/:employeeId', async (req, res) => {
  try {
    const db = getDb();
    const { period } = req.query;
    const empId = req.params.employeeId;

    // Get employee info
    const employee = await db.prepare(`
      SELECT e.*, r.name as role_name FROM employees e
      JOIN roles r ON e.role_id = r.id WHERE e.id = ?
    `).get(empId);
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    // Sales summary
    const sales = await db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'sale' THEN amount ELSE 0 END), 0) as total_sales,
        COALESCE(SUM(CASE WHEN transaction_type = 'return' THEN amount ELSE 0 END), 0) as total_returns,
        COALESCE(SUM(CASE WHEN transaction_type = 'collection' THEN amount ELSE 0 END), 0) as total_collections,
        COALESCE(SUM(CASE WHEN transaction_type = 'sale' THEN quantity ELSE 0 END), 0) as total_units,
        COUNT(DISTINCT CASE WHEN transaction_type = 'sale' THEN customer_id END) as unique_customers,
        COUNT(DISTINCT CASE WHEN transaction_type = 'sale' THEN product_id END) as unique_products
      FROM transactions WHERE employee_id = ? AND period = ?
    `).get(empId, period || '2026-01');

    // Latest payout
    const payout = await db.prepare(`
      SELECT ep.*, cr.period FROM employee_payouts ep
      JOIN calculation_runs cr ON ep.run_id = cr.id
      WHERE ep.employee_id = ? AND cr.period = ? AND cr.is_simulation = 0
      ORDER BY cr.started_at DESC LIMIT 1
    `).get(empId, period || '2026-01');

    let kpiResults = [];
    if (payout) {
      kpiResults = await db.prepare(`
        SELECT kr.*, k.name as kpi_name, k.code, k.unit, k.category
        FROM kpi_results kr
        JOIN kpi_definitions k ON kr.kpi_id = k.id
        WHERE kr.payout_id = ?
      `).all(payout.id);
    }

    res.json({ employee, sales, payout, kpi_results: kpiResults });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manager dashboard
router.get('/manager/:employeeId', async (req, res) => {
  try {
    const db = getDb();
    const { period } = req.query;
    const empId = req.params.employeeId;

    // Get direct reports
    const reports = await db.prepare(`
      SELECT e.id, e.name, r.name as role_name, e.base_salary
      FROM employees e JOIN roles r ON e.role_id = r.id
      WHERE e.reports_to = ?
    `).all(empId);

    // Get sales data for each report
    const teamData = [];
    for (const rep of reports) {
      const sales = await db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type = 'sale' THEN amount ELSE 0 END), 0) as total_sales,
          COALESCE(SUM(CASE WHEN transaction_type = 'return' THEN amount ELSE 0 END), 0) as total_returns,
          COALESCE(SUM(CASE WHEN transaction_type = 'collection' THEN amount ELSE 0 END), 0) as total_collections
        FROM transactions WHERE employee_id = ? AND period = ?
      `).get(rep.id, period || '2026-01');

      const payout = await db.prepare(`
        SELECT ep.net_payout, ep.approval_status FROM employee_payouts ep
        JOIN calculation_runs cr ON ep.run_id = cr.id
        WHERE ep.employee_id = ? AND cr.period = ? AND cr.is_simulation = 0
        ORDER BY cr.started_at DESC LIMIT 1
      `).get(rep.id, period || '2026-01');

      teamData.push({ ...rep, ...sales, payout: payout?.net_payout || 0, approval_status: payout?.approval_status || 'pending' });
    }

    // Team totals
    const totalSales = teamData.reduce((s, r) => s + r.total_sales, 0);
    const totalPayouts = teamData.reduce((s, r) => s + r.payout, 0);

    res.json({ reports: teamData, total_sales: totalSales, total_payouts: totalPayouts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Executive dashboard
router.get('/executive', async (req, res) => {
  try {
    const db = getDb();
    const { period } = req.query;
    const p = period || '2026-01';

    // Overall sales metrics
    const overall = await db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'sale' THEN amount ELSE 0 END), 0) as total_sales,
        COALESCE(SUM(CASE WHEN transaction_type = 'return' THEN amount ELSE 0 END), 0) as total_returns,
        COALESCE(SUM(CASE WHEN transaction_type = 'collection' THEN amount ELSE 0 END), 0) as total_collections,
        COUNT(DISTINCT CASE WHEN transaction_type = 'sale' THEN employee_id END) as active_salespeople
      FROM transactions WHERE period = ?
    `).get(p);

    // ── Get latest non-simulation run per plan for this period ──
    const latestRuns = (await db.prepare(`
      SELECT cr.id as run_id, cr.plan_id, cp.name as plan_name, cp.base_payout,
             cr.total_payout as run_total, cr.employee_count,
             ROW_NUMBER() OVER (PARTITION BY cr.plan_id ORDER BY cr.started_at DESC) as rn
      FROM calculation_runs cr
      JOIN commission_plans cp ON cr.plan_id = cp.id
      WHERE cr.period = ? AND cr.is_simulation = 0 AND cr.status = 'completed'
    `).all(p)).filter(r => r.rn === 1);

    const runIds = latestRuns.map(r => r.run_id);

    // ── Per-employee payouts from latest runs ──
    let leaderboard = [];
    if (runIds.length > 0) {
      const ph = runIds.map(() => '?').join(',');
      leaderboard = await db.prepare(`
        SELECT
          ep.employee_id,
          e.name as employee_name,
          t.name as territory_name,
          ep.plan_id,
          cp.name as plan_name,
          ep.gross_payout,
          ep.multiplier_amount,
          ep.penalty_amount,
          ep.cap_adjustment,
          ep.net_payout,
          ep.eligibility_status
        FROM employee_payouts ep
        JOIN employees e ON ep.employee_id = e.id
        JOIN commission_plans cp ON ep.plan_id = cp.id
        LEFT JOIN territories t ON e.territory_id = t.id
        WHERE ep.run_id IN (${ph})
        ORDER BY ep.net_payout DESC
      `).all(...runIds);
    }

    // ── Build per-employee aggregation ──
    const empMap = {};
    for (const row of leaderboard) {
      if (!empMap[row.employee_id]) {
        empMap[row.employee_id] = {
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          territory: row.territory_name,
          total_payout: 0,
          plans: [],
        };
      }
      empMap[row.employee_id].total_payout += row.net_payout;
      empMap[row.employee_id].plans.push({
        plan_name: row.plan_name,
        net_payout: row.net_payout,
        gross_payout: row.gross_payout,
        multiplier: row.multiplier_amount,
        penalty: row.penalty_amount,
        eligible: row.eligibility_status,
      });
    }

    // ── Also load KPI achievement for each employee's payouts ──
    const kpiList = []; // unique KPIs across all plans
    const kpiSet = new Set();
    if (runIds.length > 0) {
      const ph = runIds.map(() => '?').join(',');
      const kpiRows = await db.prepare(`
        SELECT kr.payout_id, ep.employee_id, kr.kpi_id, kr.achievement_percent,
               kr.actual_value, kr.target_value, kr.weighted_payout,
               kd.name as kpi_name, kd.code as kpi_code, kd.unit as kpi_unit
        FROM kpi_results kr
        JOIN employee_payouts ep ON kr.payout_id = ep.id
        JOIN kpi_definitions kd ON kr.kpi_id = kd.id
        WHERE ep.run_id IN (${ph})
      `).all(...runIds);
      for (const kr of kpiRows) {
        if (empMap[kr.employee_id]) {
          if (!empMap[kr.employee_id]._achPcts) empMap[kr.employee_id]._achPcts = [];
          empMap[kr.employee_id]._achPcts.push(kr.achievement_percent);
          if (!empMap[kr.employee_id].kpis) empMap[kr.employee_id].kpis = {};
          empMap[kr.employee_id].kpis[kr.kpi_id] = {
            achievement: kr.achievement_percent,
            actual: kr.actual_value,
            target: kr.target_value,
            payout: kr.weighted_payout,
          };
        }
        if (!kpiSet.has(kr.kpi_id)) {
          kpiSet.add(kr.kpi_id);
          kpiList.push({ id: kr.kpi_id, name: kr.kpi_name, code: kr.kpi_code, unit: kr.kpi_unit });
        }
      }
    }

    // ── Rank and classify into tiers ──
    const ranked = Object.values(empMap)
      .map(emp => {
        const pcts = emp._achPcts || [];
        const avgAch = pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;
        delete emp._achPcts;
        let tier = 'below_target';
        if (avgAch >= 120) tier = 'champion';
        else if (avgAch >= 100) tier = 'high_performer';
        else if (avgAch >= 80) tier = 'on_track';
        else if (avgAch >= 50) tier = 'developing';
        return { ...emp, avg_achievement: Math.round(avgAch * 100) / 100, tier };
      })
      .sort((a, b) => b.total_payout - a.total_payout)
      .map((emp, i) => ({ ...emp, rank: i + 1 }));

    // ── Sales data per employee ──
    const salesByEmp = {};
    if (ranked.length > 0) {
      const salesRows = await db.prepare(`
        SELECT employee_id,
          COALESCE(SUM(CASE WHEN transaction_type = 'sale' THEN amount ELSE 0 END), 0) as total_sales
        FROM transactions WHERE period = ? GROUP BY employee_id
      `).all(p);
      for (const sr of salesRows) salesByEmp[sr.employee_id] = sr.total_sales;
    }
    for (const emp of ranked) {
      emp.total_sales = salesByEmp[emp.employee_id] || 0;
    }

    // ── Tier summary ──
    const tiers = { champion: 0, high_performer: 0, on_track: 0, developing: 0, below_target: 0 };
    for (const emp of ranked) tiers[emp.tier]++;

    // ── Plan summary ──
    const planSummary = latestRuns.map(r => ({
      plan_id: r.plan_id,
      plan_name: r.plan_name,
      base_payout: r.base_payout,
      total_payout: r.run_total,
      employee_count: r.employee_count,
    }));

    // ── Payout distribution buckets ──
    const buckets = [0, 0, 0, 0, 0, 0]; // 0, 1-500, 501-1000, 1001-1500, 1501-2000, 2000+
    for (const emp of ranked) {
      const p = emp.total_payout;
      if (p === 0) buckets[0]++;
      else if (p <= 500) buckets[1]++;
      else if (p <= 1000) buckets[2]++;
      else if (p <= 1500) buckets[3]++;
      else if (p <= 2000) buckets[4]++;
      else buckets[5]++;
    }
    const distribution = [
      { range: 'AED 0', count: buckets[0] },
      { range: '1-500', count: buckets[1] },
      { range: '501-1K', count: buckets[2] },
      { range: '1K-1.5K', count: buckets[3] },
      { range: '1.5K-2K', count: buckets[4] },
      { range: '2K+', count: buckets[5] },
    ];

    // ── Territory payouts ──
    const territoryPayouts = {};
    for (const emp of ranked) {
      const t = emp.territory || 'Unassigned';
      if (!territoryPayouts[t]) territoryPayouts[t] = { territory: t, payout: 0, sales: 0, count: 0 };
      territoryPayouts[t].payout += emp.total_payout;
      territoryPayouts[t].sales += emp.total_sales;
      territoryPayouts[t].count++;
    }

    // ── Summary stats ──
    const payouts = ranked.map(r => r.total_payout).filter(v => v > 0);
    const totalPayouts = ranked.reduce((s, r) => s + r.total_payout, 0);
    const sortedPayouts = [...payouts].sort((a, b) => a - b);
    const median = sortedPayouts.length > 0
      ? sortedPayouts[Math.floor(sortedPayouts.length / 2)]
      : 0;

    res.json({
      total_sales: overall.total_sales,
      total_returns: overall.total_returns,
      total_collections: overall.total_collections,
      active_salespeople: overall.active_salespeople,
      total_payouts: totalPayouts,
      avg_payout: payouts.length > 0 ? totalPayouts / payouts.length : 0,
      median_payout: median,
      top_earner: ranked.length > 0 ? ranked[0].total_payout : 0,
      incentive_percent: overall.total_sales > 0 ? Number(((totalPayouts / overall.total_sales) * 100).toFixed(2)) : 0,
      commission_roi: totalPayouts > 0 ? Math.round(overall.total_sales / totalPayouts * 10) / 10 : 0,
      leaderboard: ranked,
      tiers,
      plans: planSummary,
      distribution,
      kpi_list: kpiList,
      by_territory: Object.values(territoryPayouts).sort((a, b) => b.payout - a.payout),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
