export async function applyMultiplier(grossPayout, multiplierRules, transactions, employee, period, db, overrides) {
  if (!multiplierRules || multiplierRules.length === 0) {
    return { amount: 0, applied: [], final_multiplier: 1 };
  }

  const sales = transactions.filter(t => t.transaction_type === 'sale');
  const totalSales = sales.reduce((sum, t) => sum + t.amount, 0);

  const metrics = {};

  const prevPeriodSales = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM transactions WHERE employee_id = ? AND period = ? AND transaction_type = 'sale'
  `).get(employee.id, getPrevPeriod(period));
  metrics.revenue_growth_percent = prevPeriodSales?.total > 0
    ? ((totalSales - prevPeriodSales.total) / prevPeriodSales.total) * 100 : 0;

  const strategicSales = sales.filter(t => t.is_strategic).reduce((sum, t) => sum + t.amount, 0);
  metrics.strategic_sku_percent = totalSales > 0 ? (strategicSales / totalSales) * 100 : 0;

  const newLaunchSales = sales.filter(t => t.is_new_launch).reduce((sum, t) => sum + t.amount, 0);
  metrics.new_launch_percent = totalSales > 0 ? (newLaunchSales / totalSales) * 100 : 0;

  if (overrides) {
    Object.assign(metrics, overrides);
  }

  const applied = [];
  const multipliers = [];

  for (const rule of multiplierRules) {
    const metricValue = metrics[rule.condition_metric] || 0;
    let passes = false;

    switch (rule.condition_operator) {
      case '>=': passes = metricValue >= rule.condition_value; break;
      case '<=': passes = metricValue <= rule.condition_value; break;
      case '>': passes = metricValue > rule.condition_value; break;
      case '<': passes = metricValue < rule.condition_value; break;
      case '=': passes = metricValue === rule.condition_value; break;
    }

    if (passes) {
      applied.push({
        name: rule.name,
        type: rule.type,
        metric_value: Math.round(metricValue * 100) / 100,
        threshold: rule.condition_value,
        multiplier: rule.multiplier_value,
        stacking: rule.stacking_mode,
      });
      multipliers.push({ value: rule.multiplier_value, mode: rule.stacking_mode });
    }
  }

  let finalMultiplier = 1;
  let additiveSum = 0;

  for (const m of multipliers) {
    switch (m.mode) {
      case 'multiplicative':
        finalMultiplier *= m.value;
        break;
      case 'additive':
        additiveSum += (m.value - 1);
        break;
      case 'highest_only':
        finalMultiplier = Math.max(finalMultiplier, m.value);
        break;
    }
  }

  finalMultiplier += additiveSum;

  const multiplierAmount = grossPayout * (finalMultiplier - 1);

  return {
    amount: Math.round(multiplierAmount * 100) / 100,
    applied,
    final_multiplier: Math.round(finalMultiplier * 1000) / 1000,
    metrics,
  };
}

function getPrevPeriod(period) {
  const [year, month] = period.split('-').map(Number);
  return `${year - 1}-${String(month).padStart(2, '0')}`;
}
