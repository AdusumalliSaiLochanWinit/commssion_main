import { v4 as uuid } from 'uuid';

export async function storePayout(db, payoutRecord, planId, period) {
  const payoutId = uuid();

  await db.prepare(`
    INSERT INTO employee_payouts (id, run_id, employee_id, plan_id, period,
      gross_payout, multiplier_amount, penalty_amount, cap_adjustment, split_adjustment,
      net_payout, eligibility_status, eligibility_details, calculation_details, approval_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(
    payoutId,
    payoutRecord.run_id,
    payoutRecord.employee.id,
    planId,
    period,
    payoutRecord.gross_payout,
    payoutRecord.multiplier_amount,
    payoutRecord.penalty_amount,
    payoutRecord.cap_adjustment,
    payoutRecord.split_adjustment,
    payoutRecord.net_payout,
    payoutRecord.eligibility_status,
    JSON.stringify(payoutRecord.eligibility_details),
    JSON.stringify(payoutRecord.calculation_details),
  );

  // Store KPI results
  for (const kpi of payoutRecord.kpi_results) {
    await db.prepare(`
      INSERT INTO kpi_results (id, payout_id, kpi_id, target_value, actual_value,
        achievement_percent, slab_rate, slab_type, raw_payout, weighted_payout, weight, calculation_details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuid(), payoutId, kpi.kpi_id, kpi.target_value, kpi.actual_value,
      kpi.achievement_percent, kpi.slab_rate, kpi.slab_type,
      kpi.raw_payout, kpi.weighted_payout, kpi.weight, kpi.calculation_details
    );
  }

  return payoutId;
}
