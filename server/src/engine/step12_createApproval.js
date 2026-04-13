import { v4 as uuid } from 'uuid';

export async function createApproval(db, payoutId) {
  await db.prepare("UPDATE employee_payouts SET approval_status = 'submitted' WHERE id = ?").run(payoutId);

  await db.prepare(`
    INSERT INTO approval_log (id, payout_id, action, acted_by, acted_by_role, comments)
    VALUES (?, ?, 'submitted', 'system', 'system', 'Auto-submitted after calculation')
  `).run(uuid(), payoutId);
}
