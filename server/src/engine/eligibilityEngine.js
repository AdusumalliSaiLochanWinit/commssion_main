export function checkEligibility(transactions, eligibilityRules, context) {
  if (!eligibilityRules || eligibilityRules.length === 0) {
    return { status: 'eligible', reduction: 0, details: [] };
  }
  
  const sales = transactions.filter(t => t.transaction_type === 'sale');
  const returns = transactions.filter(t => t.transaction_type === 'return');
  const collections = transactions.filter(t => t.transaction_type === 'collection');
  
  const totalSales = sales.reduce((sum, t) => sum + t.amount, 0);
  const totalReturns = returns.reduce((sum, t) => sum + t.amount, 0);
  const totalCollections = collections.reduce((sum, t) => sum + t.amount, 0);
  
  const metrics = {
    min_sales: totalSales,
    min_collection_percent: totalSales > 0 ? (totalCollections / totalSales) * 100 : 0,
    max_return_percent: totalSales > 0 ? (totalReturns / totalSales) * 100 : 0,
    min_active_days: 22, // Default for prototype
    min_lines_sold: new Set(sales.map(t => t.product_id)).size,
  };
  
  let status = 'eligible';
  let reduction = 0;
  const details = [];
  
  for (const rule of eligibilityRules) {
    const metricValue = metrics[rule.metric] || 0;
    let passes = true;
    
    switch (rule.operator) {
      case '>=': passes = metricValue >= rule.threshold; break;
      case '<=': passes = metricValue <= rule.threshold; break;
      case '>': passes = metricValue > rule.threshold; break;
      case '<': passes = metricValue < rule.threshold; break;
      case '=': passes = metricValue === rule.threshold; break;
    }
    
    const detail = {
      metric: rule.metric,
      operator: rule.operator,
      threshold: rule.threshold,
      actual: Math.round(metricValue * 100) / 100,
      passed: passes,
      action: rule.action,
    };
    
    if (!passes) {
      switch (rule.action) {
        case 'zero_payout':
          status = 'ineligible';
          detail.impact = 'Payout set to zero';
          break;
        case 'reduce_percent':
          if (status !== 'ineligible') status = 'reduced';
          reduction = Math.max(reduction, rule.reduction_percent);
          detail.impact = `Payout reduced by ${rule.reduction_percent}%`;
          break;
        case 'warning_only':
          detail.impact = 'Warning only - no payout impact';
          break;
      }
    }
    
    details.push(detail);
  }
  
  return { status, reduction, details };
}
