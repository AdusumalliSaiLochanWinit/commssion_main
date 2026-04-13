export function applyCap(currentPayout, cappingRules, employee) {
  if (!cappingRules || cappingRules.length === 0) {
    return { capped: currentPayout, adjustment: 0, applied: null };
  }
  
  let mostRestrictive = currentPayout;
  let appliedCap = null;
  
  for (const rule of cappingRules) {
    let capAmount;
    
    switch (rule.cap_type) {
      case 'max_per_plan':
        capAmount = rule.cap_value;
        break;
      case 'percent_of_salary':
        capAmount = employee.base_salary * (rule.cap_value / 100);
        break;
      case 'max_per_kpi':
        capAmount = rule.cap_value;
        break;
      default:
        continue;
    }
    
    if (capAmount < mostRestrictive) {
      mostRestrictive = capAmount;
      appliedCap = {
        cap_type: rule.cap_type,
        cap_value: rule.cap_value,
        calculated_cap: capAmount,
      };
    }
  }
  
  return {
    capped: Math.round(Math.min(currentPayout, mostRestrictive) * 100) / 100,
    adjustment: Math.round(Math.max(0, currentPayout - mostRestrictive) * 100) / 100,
    applied: appliedCap,
  };
}
