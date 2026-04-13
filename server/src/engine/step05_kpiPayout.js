export function calculateKpiPayout(achievement, slabResult, context) {
  const basePayout = context.basePayout;
  let amount = 0;
  
  if (slabResult.type === 'progressive') {
    // For progressive, the rate is already the calculated total
    if (slabResult.rate_type === 'per_unit') {
      amount = achievement.actual * slabResult.rate;
    } else {
      amount = basePayout * slabResult.rate / 100;
    }
  } else {
    // For step and accelerator
    if (slabResult.rate_type === 'percentage') {
      amount = basePayout * slabResult.rate / 100;
    } else if (slabResult.rate_type === 'fixed') {
      amount = slabResult.rate;
    } else if (slabResult.rate_type === 'per_unit') {
      amount = achievement.actual * slabResult.rate;
    }
  }
  
  return {
    amount: Math.round(amount * 100) / 100,
    base_payout: basePayout,
    slab_rate: slabResult.rate,
    rate_type: slabResult.rate_type,
  };
}
