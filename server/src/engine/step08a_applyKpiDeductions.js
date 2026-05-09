function inRange(value, rule) {
  const minOk = rule.min_value == null
    ? true
    : (rule.min_inclusive ? value >= rule.min_value : value > rule.min_value);
  const maxOk = rule.max_value == null
    ? true
    : (rule.max_inclusive ? value <= rule.max_value : value < rule.max_value);
  return minOk && maxOk;
}

function computeMetricValue(kpi, metricType) {
  if (metricType === 'achievement_percent') {
    return Number(kpi.achievement_percent || 0);
  }

  if (metricType === 'actual_value') {
    return Number(kpi.actual_value || 0);
  }

  // shortfall_percent
  return Math.max(0, 100 - Number(kpi.achievement_percent || 0));
}

export function applyKpiDeductions(currentPayout, kpiResults, deductionRules, employee) {
  if (!deductionRules || deductionRules.length === 0 || !kpiResults || kpiResults.length === 0) {
    return { amount: 0, total_percent: 0, triggered: [] };
  }

  const triggered = [];
  let totalPercent = 0;

  for (const kpi of kpiResults) {
    const kpiRules = deductionRules
      .filter(r =>
        (!r.role_id || r.role_id === employee.role_id) &&
        (!r.kpi_id || r.kpi_id === kpi.kpi_id)
      )
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

    if (kpiRules.length === 0) continue;

    let selected = null;
    let selectedMetric = 0;
    for (const rule of kpiRules) {
      const metricValue = computeMetricValue(kpi, rule.metric_type || 'shortfall_percent');
      if (inRange(metricValue, rule)) {
        if (!selected || (rule.deduction_percent > selected.deduction_percent)) {
          selected = rule;
          selectedMetric = metricValue;
        }
      }
    }

    if (selected) {
      const pct = Number(selected.deduction_percent || 0);
      totalPercent += pct;
      triggered.push({
        kpi_id: kpi.kpi_id,
        kpi_name: kpi.kpi_name,
        kpi_code: kpi.kpi_code,
        rule_id: selected.id,
        rule_name: selected.name,
        metric_type: selected.metric_type,
        metric_value: Math.round(selectedMetric * 100) / 100,
        deduction_percent: pct,
      });
    }
  }

  totalPercent = Math.max(0, Math.min(100, totalPercent));
  const amount = currentPayout * (totalPercent / 100);

  return {
    amount: Math.round(amount * 100) / 100,
    total_percent: Math.round(totalPercent * 100) / 100,
    triggered,
  };
}
