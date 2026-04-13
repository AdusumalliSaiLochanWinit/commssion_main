export function determineSlab(achievementPercent, slabSet, overrides) {
  if (!slabSet) {
    // No slab configured - use linear interpolation
    return {
      type: 'linear',
      rate: achievementPercent >= 70 ? Math.min(achievementPercent / 100, 1.5) * 5 : 0,
      tier: null,
      details: 'No slab configured, using linear rate',
    };
  }
  
  const tiers = overrides?.tiers || slabSet.tiers;
  const type = slabSet.type;
  
  switch (type) {
    case 'step':
      return calculateStepSlab(achievementPercent, tiers);
    case 'progressive':
      return calculateProgressiveSlab(achievementPercent, tiers);
    case 'accelerator':
      return calculateAcceleratorSlab(achievementPercent, tiers);
    default:
      return { type: 'unknown', rate: 0, tier: null, details: `Unknown slab type: ${type}` };
  }
}

// Step slab: flat rate based on which tier the achievement falls into
function calculateStepSlab(percent, tiers) {
  let matchedTier = null;
  
  for (const tier of tiers) {
    const max = tier.max_percent ?? Infinity;
    if (percent >= tier.min_percent && percent < max) {
      matchedTier = tier;
      break;
    }
    // Handle the last open-ended tier
    if (tier.max_percent === null && percent >= tier.min_percent) {
      matchedTier = tier;
      break;
    }
  }
  
  return {
    type: 'step',
    rate: matchedTier?.rate || 0,
    rate_type: matchedTier?.rate_type || 'percentage',
    tier: matchedTier?.tier_order || 0,
    details: matchedTier ? `Tier ${matchedTier.tier_order}: ${matchedTier.min_percent}%-${matchedTier.max_percent ?? '∞'}% = ${matchedTier.rate}%` : 'Below minimum tier',
  };
}

// Progressive slab: rate applied to portion within each tier
function calculateProgressiveSlab(percent, tiers) {
  let totalRate = 0;
  const breakdown = [];
  
  for (const tier of tiers) {
    const max = tier.max_percent ?? Infinity;
    if (percent <= tier.min_percent) break;
    
    const applicable = Math.min(percent, max) - tier.min_percent;
    const tierContribution = applicable * tier.rate / 100;
    totalRate += tierContribution;
    
    breakdown.push({
      tier: tier.tier_order,
      range: `${tier.min_percent}%-${tier.max_percent ?? '∞'}%`,
      applicable_percent: applicable,
      rate: tier.rate,
      contribution: tierContribution,
    });
  }
  
  return {
    type: 'progressive',
    rate: Math.round(totalRate * 100) / 100,
    rate_type: tiers[0]?.rate_type || 'percentage',
    tier: breakdown.length,
    details: breakdown,
  };
}

// Accelerator: base rate below 100%, accelerated rate above 100%
function calculateAcceleratorSlab(percent, tiers) {
  let rate = 0;
  let matchedTier = null;
  
  // Below 100%: use base tier rate
  // Above 100%: use accelerated tier rate for the entire amount
  for (const tier of tiers) {
    const max = tier.max_percent ?? Infinity;
    if (percent >= tier.min_percent && percent < max) {
      matchedTier = tier;
      rate = tier.rate;
      break;
    }
    if (tier.max_percent === null && percent >= tier.min_percent) {
      matchedTier = tier;
      rate = tier.rate;
      break;
    }
  }
  
  return {
    type: 'accelerator',
    rate,
    rate_type: matchedTier?.rate_type || 'percentage',
    tier: matchedTier?.tier_order || 0,
    is_accelerated: percent > 100,
    details: `${percent > 100 ? 'Accelerated' : 'Base'} rate: ${rate}%`,
  };
}
