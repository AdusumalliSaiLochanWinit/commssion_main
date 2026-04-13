export function applyPenalty(currentPayout, penaltyRules, transactions) {
  if (!penaltyRules || penaltyRules.length === 0) {
    return { amount: 0, triggered: [], total_penalty_percent: 0 };
  }
  
  const sales = transactions.filter(t => t.transaction_type === 'sale');
  const returns = transactions.filter(t => t.transaction_type === 'return');
  const totalSales = sales.reduce((sum, t) => sum + t.amount, 0);
  const totalReturns = returns.reduce((sum, t) => sum + t.amount, 0);
  
  // Calculate metrics
  const metrics = {
    return_percent: totalSales > 0 ? (totalReturns / totalSales) * 100 : 0,
  };
  
  let totalPenalty = 0;
  const triggered = [];
  
  for (const rule of penaltyRules) {
    const metricValue = metrics[rule.trigger_metric] || 0;
    let passes = false;
    
    switch (rule.trigger_operator) {
      case '>=': passes = metricValue >= rule.trigger_value; break;
      case '<=': passes = metricValue <= rule.trigger_value; break;
      case '>': passes = metricValue > rule.trigger_value; break;
      case '<': passes = metricValue < rule.trigger_value; break;
      case '=': passes = metricValue === rule.trigger_value; break;
    }
    
    if (passes) {
      let penaltyAmount = 0;
      
      switch (rule.penalty_type) {
        case 'percentage':
          penaltyAmount = currentPayout * (rule.penalty_value / 100);
          break;
        case 'fixed':
          penaltyAmount = rule.penalty_value;
          break;
      }
      
      totalPenalty += penaltyAmount;
      triggered.push({
        name: rule.name,
        metric_value: Math.round(metricValue * 100) / 100,
        threshold: rule.trigger_value,
        penalty_type: rule.penalty_type,
        penalty_value: rule.penalty_value,
        penalty_amount: Math.round(penaltyAmount * 100) / 100,
      });
    }
  }
  
  return {
    amount: Math.round(totalPenalty * 100) / 100,
    triggered,
    total_penalty_percent: currentPayout > 0 ? Math.round((totalPenalty / currentPayout) * 100 * 100) / 100 : 0,
  };
}
