// Structured Formula Evaluator
// Dynamically evaluates KPI formulas stored as JSON in kpi_definitions.formula

const VALID_FIELDS = ['amount', 'quantity', 'customer_id', 'product_id', 'base_amount'];
const VALID_FILTER_FIELDS = ['is_strategic', 'is_new_launch', 'product_category', 'product_sku', 'customer_channel', 'customer_group', 'event_type', 'tag'];
const VALID_AGGREGATIONS = ['SUM', 'COUNT_DISTINCT', 'AVG', 'COUNT'];
const VALID_TX_TYPES = ['sale', 'return', 'collection', 'event', 'all'];

export async function evaluateFormula(formulaJson, transactions, employee, period, db) {
  const formula = parseFormula(formulaJson);
  if (!formula) return null;

  switch (formula.type) {
    case 'simple':
      return evaluateSimple(formula, transactions);
    case 'ratio':
      return evaluateRatio(formula, transactions);
    case 'growth':
      return await evaluateGrowth(formula, transactions, employee, period, db);
    case 'team':
      return await evaluateTeam(formula, employee, period, db);
    case 'static':
      return formula.defaultValue ?? 0;
    default:
      return null;
  }
}

function parseFormula(formulaJson) {
  if (!formulaJson) return null;
  if (typeof formulaJson === 'object' && formulaJson.type) return formulaJson;
  if (typeof formulaJson !== 'string') return null;
  try {
    const parsed = JSON.parse(formulaJson);
    if (parsed && typeof parsed === 'object' && parsed.type) return parsed;
    return null;
  } catch {
    return null;
  }
}

function filterTransactions(transactions, metric) {
  let filtered = transactions;

  if (metric.transactionType && metric.transactionType !== 'all') {
    filtered = filtered.filter(t => t.transaction_type === metric.transactionType);
  }

  if (Array.isArray(metric.filters)) {
    for (const f of metric.filters) {
      if (!VALID_FILTER_FIELDS.includes(f.field)) continue;

      // Tag-based filter (§22.8): checks if txn has matching tag
      // Requires tagContext to be passed via the transactions' _tag_ids helper
      if (f.field === 'tag') {
        const tagVals = Array.isArray(f.value) ? f.value : [f.value];
        filtered = filtered.filter(t => {
          const tags = t._tag_ids || [];
          return f.operator === 'not_in'
            ? !tagVals.some(v => tags.includes(v))
            : tagVals.some(v => tags.includes(v));
        });
        continue;
      }

      filtered = filtered.filter(t => {
        const colName = f.field === 'product_sku' ? 'sku' : f.field === 'product_category' ? 'product_category' : f.field;
        const val = t[colName];
        switch (f.operator) {
          case '=':  return val == f.value;
          case '!=': return val != f.value;
          case 'in': return Array.isArray(f.value) && f.value.includes(val);
          case 'not_in': return Array.isArray(f.value) && !f.value.includes(val);
          default: return true;
        }
      });
    }
  }

  return filtered;
}

function aggregate(transactions, aggregation, field) {
  if (!VALID_FIELDS.includes(field) && aggregation !== 'COUNT') return 0;

  switch (aggregation) {
    case 'SUM':
      return transactions.reduce((sum, t) => sum + (Number(t[field]) || 0), 0);
    case 'COUNT':
      return transactions.length;
    case 'COUNT_DISTINCT':
      return new Set(transactions.map(t => t[field])).size;
    case 'AVG': {
      if (transactions.length === 0) return 0;
      const total = transactions.reduce((sum, t) => sum + (Number(t[field]) || 0), 0);
      return total / transactions.length;
    }
    default:
      return 0;
  }
}

function evaluateMetric(metric, transactions) {
  const filtered = filterTransactions(transactions, metric);
  return aggregate(filtered, metric.aggregation, metric.field);
}

function evaluateSimple(formula, transactions) {
  return evaluateMetric(formula, transactions);
}

function evaluateRatio(formula, transactions) {
  const num = evaluateMetric(formula.numerator, transactions);
  const den = evaluateMetric(formula.denominator, transactions);
  if (den === 0) return 0;
  const ratio = num / den;
  return ratio * (formula.multiplyBy || 1);
}

async function evaluateGrowth(formula, transactions, employee, period, db) {
  const current = evaluateMetric(formula.baseMetric, transactions);

  const [year, month] = period.split('-').map(Number);
  let prevPeriod;
  if (formula.compareWith === 'previous_month') {
    const pm = month === 1 ? 12 : month - 1;
    const py = month === 1 ? year - 1 : year;
    prevPeriod = `${py}-${String(pm).padStart(2, '0')}`;
  } else {
    prevPeriod = `${year - 1}-${String(month).padStart(2, '0')}`;
  }

  const prev = await queryMetric(formula.baseMetric, employee.id, prevPeriod, db);
  if (prev === 0) return 0;
  return ((current - prev) / prev) * 100;
}

async function evaluateTeam(formula, employee, period, db) {
  const reports = await db.prepare('SELECT id FROM employees WHERE reports_to = ?').all(employee.id);
  const values = [];
  for (const rep of reports) {
    const val = await queryMetric(formula.baseMetric, rep.id, period, db);
    values.push(val);
  }

  const teamAgg = formula.teamAggregation || 'SUM';
  switch (teamAgg) {
    case 'SUM':
      return values.reduce((a, b) => a + b, 0);
    case 'AVG':
      return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    case 'COUNT':
      return values.length;
    default:
      return values.reduce((a, b) => a + b, 0);
  }
}

async function queryMetric(metric, employeeId, period, db) {
  const txType = VALID_TX_TYPES.includes(metric.transactionType) ? metric.transactionType : 'sale';
  const field = VALID_FIELDS.includes(metric.field) ? metric.field : 'amount';
  const agg = VALID_AGGREGATIONS.includes(metric.aggregation) ? metric.aggregation : 'SUM';

  const params = [employeeId, period];

  const needsProductJoin = (metric.filters || []).some(f => ['is_strategic', 'is_new_launch', 'product_category', 'product_sku'].includes(f.field));
  const needsCustomerJoin = (metric.filters || []).some(f => ['customer_channel', 'customer_group'].includes(f.field));

  let joins = '';
  if (needsProductJoin) joins += ' JOIN products p ON t.product_id = p.id';
  if (needsCustomerJoin) joins += ' JOIN customers c ON t.customer_id = c.id';

  let filterClauses = '';
  if (Array.isArray(metric.filters)) {
    for (const f of metric.filters) {
      if (!VALID_FILTER_FIELDS.includes(f.field)) continue;
      const col = mapFilterFieldToColumn(f.field);
      if (f.operator === '=' || f.operator === '!=') {
        filterClauses += ` AND ${col} ${f.operator === '!=' ? '!=' : '='} ?`;
        params.push(f.value);
      } else if (f.operator === 'in' && Array.isArray(f.value)) {
        filterClauses += ` AND ${col} IN (${f.value.map(() => '?').join(',')})`;
        params.push(...f.value);
      } else if (f.operator === 'not_in' && Array.isArray(f.value)) {
        filterClauses += ` AND ${col} NOT IN (${f.value.map(() => '?').join(',')})`;
        params.push(...f.value);
      }
    }
  }

  const typeClause = txType !== 'all' ? ` AND t.transaction_type = '${txType}'` : '';

  let aggExpr;
  switch (agg) {
    case 'SUM':
      aggExpr = `COALESCE(SUM(t.${field}), 0)`;
      break;
    case 'COUNT':
      aggExpr = 'COUNT(*)';
      break;
    case 'COUNT_DISTINCT':
      aggExpr = `COUNT(DISTINCT t.${field})`;
      break;
    case 'AVG':
      aggExpr = `COALESCE(AVG(t.${field}), 0)`;
      break;
    default:
      aggExpr = `COALESCE(SUM(t.${field}), 0)`;
  }

  const sql = `SELECT ${aggExpr} as val FROM transactions t${joins} WHERE t.employee_id = ? AND t.period = ?${typeClause}${filterClauses}`;

  const row = await db.prepare(sql).get(...params);
  return row ? row.val : 0;
}

function mapFilterFieldToColumn(field) {
  switch (field) {
    case 'is_strategic': return 'p.is_strategic';
    case 'is_new_launch': return 'p.is_new_launch';
    case 'product_category': return 'p.category';
    case 'product_sku': return 'p.sku';
    case 'customer_channel': return 'c.channel';
    case 'customer_group': return 'c.customer_group';
    default: return `t.${field}`;
  }
}

export function formulaToText(formulaJson) {
  const formula = parseFormula(formulaJson);
  if (!formula) return typeof formulaJson === 'string' ? formulaJson : '';

  switch (formula.type) {
    case 'simple':
      return metricToText(formula);
    case 'ratio': {
      const num = metricToText(formula.numerator);
      const den = metricToText(formula.denominator);
      const mult = formula.multiplyBy && formula.multiplyBy !== 1 ? ` × ${formula.multiplyBy}` : '';
      return `(${num} / ${den})${mult}`;
    }
    case 'growth':
      return `Growth of ${metricToText(formula.baseMetric)} vs ${(formula.compareWith || 'previous_year').replace(/_/g, ' ')}`;
    case 'team':
      return `${formula.teamAggregation || 'SUM'} of team's ${metricToText(formula.baseMetric)}`;
    case 'static':
      return `Static: ${formula.defaultValue ?? 0}${formula.source ? ` (${formula.source})` : ''}`;
    default:
      return JSON.stringify(formulaJson);
  }
}

function metricToText(metric) {
  if (!metric) return '';
  const agg = metric.aggregation || 'SUM';
  const field = metric.field || 'amount';
  const type = metric.transactionType || 'all';
  const filters = (metric.filters || [])
    .map(f => `${f.field}${f.operator}${f.value}`)
    .join(' AND ');
  const where = [
    type !== 'all' ? `type=${type}` : '',
    filters,
  ].filter(Boolean).join(' AND ');

  return `${agg}(${field})${where ? ' WHERE ' + where : ''}`;
}
