export function aggregateKpis(kpiResults) {
  const total = kpiResults.reduce((sum, kpi) => sum + kpi.weighted_payout, 0);
  return Math.round(total * 100) / 100;
}
