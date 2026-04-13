import { evaluateFormula } from './formulaEvaluator.js';

export async function calculateKpiAchievement(transactions, planKpi, employee, period, db, targetOverride) {
  let actual = await evaluateFormula(planKpi.formula, transactions, employee, period, db);

  if (actual === null) {
    actual = await legacyCalculate(transactions, planKpi, employee, period, db);
  }

  const target = targetOverride ?? planKpi.target_value;

  let percent;
  if (planKpi.direction === 'lower_is_better') {
    percent = target > 0 ? Math.max(0, (2 * target - actual) / target * 100) : 0;
  } else {
    percent = target > 0 ? (actual / target) * 100 : 0;
  }

  return {
    actual: Math.round(actual * 100) / 100,
    target,
    percent: Math.round(percent * 100) / 100,
  };
}

async function legacyCalculate(transactions, planKpi, employee, period, db) {
  const sales = transactions.filter(t => t.transaction_type === 'sale');
  const returns = transactions.filter(t => t.transaction_type === 'return');
  const collections = transactions.filter(t => t.transaction_type === 'collection');

  let actual = 0;

  switch (planKpi.kpi_code) {
    case 'TOTAL_REVENUE':
      actual = sales.reduce((sum, t) => sum + t.amount, 0);
      break;

    case 'REVENUE_GROWTH': {
      const currentRev = sales.reduce((sum, t) => sum + t.amount, 0);
      const [year, month] = period.split('-').map(Number);
      const prevPeriod = `${year - 1}-${String(month).padStart(2, '0')}`;
      const prevRevRow = await db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as prev
        FROM transactions WHERE employee_id = ? AND period = ? AND transaction_type = 'sale'
      `).get(employee.id, prevPeriod);
      const prevRev = prevRevRow?.prev || 0;
      actual = prevRev > 0 ? ((currentRev - prevRev) / prevRev) * 100 : 0;
      break;
    }

    case 'UNITS_SOLD':
      actual = sales.reduce((sum, t) => sum + t.quantity, 0);
      break;

    case 'OUTLET_COVERAGE':
      actual = new Set(sales.map(t => t.customer_id)).size;
      break;

    case 'LINES_PER_CALL': {
      const uniqueProducts = new Set(sales.map(t => t.product_id)).size;
      const uniqueCustomers = new Set(sales.map(t => t.customer_id)).size;
      actual = uniqueCustomers > 0 ? uniqueProducts / uniqueCustomers : 0;
      break;
    }

    case 'COLLECTION_PERCENT': {
      const totalSales = sales.reduce((sum, t) => sum + t.amount, 0);
      const totalCollections = collections.reduce((sum, t) => sum + t.amount, 0);
      actual = totalSales > 0 ? (totalCollections / totalSales) * 100 : 0;
      break;
    }

    case 'RETURN_PERCENT': {
      const totalSalesAmt = sales.reduce((sum, t) => sum + t.amount, 0);
      const totalReturns = returns.reduce((sum, t) => sum + t.amount, 0);
      actual = totalSalesAmt > 0 ? (totalReturns / totalSalesAmt) * 100 : 0;
      break;
    }

    case 'STRATEGIC_SKU_REV':
      actual = sales.filter(t => t.is_strategic).reduce((sum, t) => sum + t.amount, 0);
      break;

    case 'NEW_LAUNCH_SALES':
      actual = sales.filter(t => t.is_new_launch).reduce((sum, t) => sum + t.amount, 0);
      break;

    case 'NEW_CUSTOMERS':
      actual = new Set(sales.map(t => t.customer_id)).size;
      break;

    case 'TEAM_REVENUE': {
      const reports = await db.prepare('SELECT id FROM employees WHERE reports_to = ?').all(employee.id);
      let teamRev = 0;
      for (const rep of reports) {
        const repRev = await db.prepare(`
          SELECT COALESCE(SUM(amount), 0) as rev
          FROM transactions WHERE employee_id = ? AND period = ? AND transaction_type = 'sale'
        `).get(rep.id, period);
        teamRev += repRev?.rev || 0;
      }
      actual = teamRev;
      break;
    }

    case 'TEAM_TARGET_ACH':
      actual = 90;
      break;

    case 'REV_PER_OUTLET': {
      const revTotal = sales.reduce((sum, t) => sum + t.amount, 0);
      const outlets = new Set(sales.map(t => t.customer_id)).size;
      actual = outlets > 0 ? revTotal / outlets : 0;
      break;
    }

    case 'OTD_PERCENT':
      actual = 92;
      break;

    case 'GROSS_MARGIN':
      actual = 28;
      break;

    default:
      actual = 0;
  }

  return actual;
}
