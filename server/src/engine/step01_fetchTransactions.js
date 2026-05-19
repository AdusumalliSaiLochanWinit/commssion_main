/**
 * Fetch all commission sources for an employee in a period.
 *
 * Sources:
 *   1. Standard transactions (sales, returns, collections)
 *   2. Commission events (§5) — promoted to synthetic transactions so the
 *      existing KPI/slab/payout pipeline can consume them uniformly
 *
 * Currency normalization:
 *   - Each transaction has a `currency` column
 *   - `base_amount` is set to the AED-equivalent value using exchange_rates
 *     as-of the transaction_date. If missing, it defaults to `amount`.
 *   - Downstream KPIs that sum `amount` continue to work; KPIs that need
 *     base currency can use `base_amount`.
 */
export async function fetchScopedTransactions(db, employeeId, period, territoryId, roleId = null) {
  // Early exit if no employee provided
  if (!employeeId) {
    return [];
  }
  
  // Build employee scope: self + all active descendants in the reporting tree.
  // This enables supervisor/ASM plans to evaluate KPIs on team business while
  // keeping salesman/helper runs unchanged (no descendants => self only).
  const allEmployees = await db.prepare(`
    SELECT id, reports_to
    FROM employees
    WHERE is_active = 1
  `).all();
  
  // Early exit if no active employees
  if (!allEmployees || allEmployees.length === 0) {
    return [];
  }

  const childrenByManager = new Map();
  for (const e of allEmployees) {
    if (!e.reports_to) continue;
    const arr = childrenByManager.get(e.reports_to) || [];
    arr.push(e.id);
    childrenByManager.set(e.reports_to, arr);
  }

  const scopedEmployeeIds = [];
  const visited = new Set();
  const queue = [employeeId];
  while (queue.length > 0) {
    const curr = queue.shift();
    if (!curr || visited.has(curr)) continue;
    visited.add(curr);
    scopedEmployeeIds.push(curr);
    const kids = childrenByManager.get(curr) || [];
    for (const kid of kids) queue.push(kid);
  }

  // Fallback for supervisor/manager runs:
  // If org-reporting links are missing, expand scope to active employees in the
  // same territory subtree so supervisor KPI runs can still evaluate team business.
  const supervisorRoles = new Set(['role-route-sup', 'role-ss', 'role-asm', 'role-rsm', 'role-depot-mgr']);
  if (supervisorRoles.has(roleId) && scopedEmployeeIds.length <= 1 && territoryId) {
    const allTerritories = await db.prepare('SELECT id, parent_id FROM territories').all();
    const subtree = new Set([territoryId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of allTerritories) {
        if (!subtree.has(t.id) && t.parent_id && subtree.has(t.parent_id)) {
          subtree.add(t.id);
          changed = true;
        }
      }
    }

    const terrPh = Array.from(subtree).map(() => '?').join(',');
    const territoryEmployees = await db.prepare(`
      SELECT id
      FROM employees
      WHERE is_active = 1
        AND id <> ?
        AND territory_id IN (${terrPh})
    `).all(employeeId, ...Array.from(subtree));

    for (const e of territoryEmployees) {
      if (!visited.has(e.id)) {
        visited.add(e.id);
        scopedEmployeeIds.push(e.id);
      }
    }
  }

  const empPh = scopedEmployeeIds.map(() => '?').join(',');

  // --- 1. Standard transactions ---
  const transactions = await db.prepare(`
    SELECT t.*, p.name as product_name, p.category as product_category, p.sku,
           p.is_strategic, p.is_new_launch, p.tags as product_tags,
           c.name as customer_name, c.channel as customer_channel,
           c.customer_group, c.customer_group_name, c.tags as customer_tags
    FROM transactions t
    JOIN products p ON t.product_id = p.id
    JOIN customers c ON t.customer_id = c.id
    WHERE t.employee_id IN (${empPh}) AND t.period = ?
    ORDER BY t.transaction_date
  `).all(...scopedEmployeeIds, period);

  // --- Currency normalization ---
  // Build a quick rate lookup: from_ccy → rate to AED (base currency)
  let rates = {};
  try {
    const rows = await db.prepare(`
      SELECT from_currency, to_currency, rate FROM exchange_rates
      WHERE to_currency = 'AED' OR from_currency = 'AED'
    `).all();
    for (const r of rows) {
      if (r.from_currency === 'AED') {
        // AED → X, so X → AED = 1/rate
        rates[r.to_currency] = 1 / r.rate;
      } else if (r.to_currency === 'AED') {
        rates[r.from_currency] = r.rate;
      }
    }
    rates.AED = 1;
  } catch {
    rates = { AED: 1 };
  }

  for (const t of transactions) {
    const ccy = t.currency || 'AED';
    const rate = rates[ccy] ?? 1;
    if (t.base_amount == null) {
      t.base_amount = Math.round(t.amount * rate * 100) / 100;
    }
    if (!t.currency) t.currency = 'AED';
    if (t.exchange_rate == null) t.exchange_rate = rate;
  }

  // --- 2. Commission events promoted to synthetic transactions (§5) ---
  // Only validated events count toward commission
  let events = [];
  try {
    events = await db.prepare(`
      SELECT ce.*
      FROM commission_events ce
      WHERE ce.employee_id IN (${empPh}) AND ce.period = ? AND ce.validated = 1
    `).all(...scopedEmployeeIds, period);
  } catch {
    events = [];
  }

  // Promote each event to a synthetic transaction with event_type tagging
  // so the formula evaluator can filter on event_type just like transaction_type.
  const syntheticTxns = events.map(e => {
    let meta = {};
    try { meta = JSON.parse(e.metadata || '{}'); } catch {}
    return {
      id: `evt-${e.id}`,
      employee_id: e.employee_id,
      customer_id: meta.customer_id || null,
      product_id: meta.product_id || null,
      transaction_type: 'event',             // distinguishes from sale/return/collection
      event_type: e.event_type,              // for §5 event-type KPI filtering
      quantity: e.value || 0,
      amount: e.value || 0,
      base_amount: e.value || 0,
      currency: 'AED',
      exchange_rate: 1,
      transaction_date: e.event_date,
      period: e.period,
      territory_id: territoryId,
      product_name: null,
      product_category: null,
      sku: null,
      is_strategic: 0,
      is_new_launch: 0,
      product_tags: '[]',
      customer_name: null,
      customer_channel: null,
      customer_group: null,
      customer_group_name: null,
      customer_tags: '[]',
      _event_source: true,
      _reference_id: e.reference_id,
      _metadata: meta,
    };
  });

  return [...transactions, ...syntheticTxns];
}
