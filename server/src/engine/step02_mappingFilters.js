/**
 * Advanced rule engine — supports:
 * §22.2 Include/Exclude precedence (exclude overrides include)
 * §22.4 Rule types: include, exclude, nested (via parent_rule_id)
 * §22.7 Conditional logic (IF ... THEN ... EXCEPT ...) via rules.conditional_logic JSON
 * §22.8 Attribute-based tagging (match_type = 'tag')
 * §22.10 Time-bound rules (valid_from / valid_to)
 *
 * Tag lookups are preloaded once per calculation run and passed in `tagContext`
 * to avoid per-transaction DB hits.
 */

/** Parse match_values (may be stringified JSON). */
function parseValues(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return [raw]; }
}

/** Check if a txn has any of the given tags (via tagContext lookup). */
function txnMatchesTags(txn, tagIds, tagContext) {
  if (!tagContext) return false;
  const prodTags = tagContext.productTags[txn.product_id] || [];
  const custTags = tagContext.customerTags[txn.customer_id] || [];
  const terrTags = tagContext.territoryTags[txn.territory_id] || [];
  const all = new Set([...prodTags, ...custTags, ...terrTags]);
  return tagIds.some(t => all.has(t));
}

/** Check if rule is active at the given date (§22.10 time-bound). */
function isRuleActive(rule, asOf) {
  if (rule.valid_from && asOf < rule.valid_from) return false;
  if (rule.valid_to && asOf > rule.valid_to) return false;
  return true;
}

/** Evaluate §22.7 conditional logic. Returns true if the IF branch matches. */
function evaluateConditional(logic, txn) {
  if (!logic) return true;
  let parsed = logic;
  if (typeof logic === 'string') {
    try { parsed = JSON.parse(logic); } catch { return true; }
  }
  if (!parsed.if) return true;

  const { field, op, value } = parsed.if;
  const actual = txn[field];
  let cond = false;
  switch (op) {
    case '=': case '==': cond = actual == value; break;
    case '!=': cond = actual != value; break;
    case '>': cond = Number(actual) > Number(value); break;
    case '<': cond = Number(actual) < Number(value); break;
    case '>=': cond = Number(actual) >= Number(value); break;
    case '<=': cond = Number(actual) <= Number(value); break;
    case 'in': cond = Array.isArray(value) && value.includes(actual); break;
    case 'not_in': cond = Array.isArray(value) && !value.includes(actual); break;
    default: cond = true;
  }
  return cond ? (parsed.then !== 'skip') : (parsed.else !== 'skip');
}

/** Does a single rule match a transaction? */
function ruleMatches(rule, txn, tagContext, asOf) {
  if (!isRuleActive(rule, asOf)) return false;
  if (!evaluateConditional(rule.conditional_logic, txn)) return false;

  const values = parseValues(rule.match_values);
  if (values.length === 0) return false;

  // Tag-based matching (§22.8)
  if (rule.match_type === 'tag') {
    return txnMatchesTags(txn, values, tagContext);
  }

  // Standard dimension matching
  switch (rule.dimension) {
    case 'product':
      return values.includes(txn.product_id);
    case 'product_category':
      return values.includes(txn.product_category);
    case 'product_sku':
      return values.includes(txn.sku);
    case 'customer':
      return values.includes(txn.customer_id);
    case 'customer_channel':
      return values.includes(txn.customer_channel);
    case 'customer_group':
      return values.includes(txn.customer_group);
    case 'territory':
      return values.includes(txn.territory_id);
    case 'transaction_type':
      return values.includes(txn.transaction_type);
    default:
      return false;
  }
}

/**
 * Recursively walk nested rules. Child rules (via parent_rule_id) modify parent's
 * match with AND semantics.
 *
 * Example: parent "include all Premium Beverages" + child "exclude Water sub-category"
 * => includes only non-Water Premium Beverages
 */
function ruleMatchesRecursive(rule, allRules, txn, tagContext, asOf) {
  const parentMatch = ruleMatches(rule, txn, tagContext, asOf);
  if (!parentMatch) return false;

  // Find children
  const children = allRules.filter(r => r.parent_rule_id === rule.id);
  if (children.length === 0) return true;

  // Children are exceptions — if any child's exclude matches, the parent doesn't apply
  for (const child of children) {
    if (child.rule_type === 'exclude' && ruleMatches(child, txn, tagContext, asOf)) {
      return false;
    }
    if (child.rule_type === 'include' && !ruleMatches(child, txn, tagContext, asOf)) {
      return false;
    }
  }
  return true;
}

/**
 * Main filter function. Supports:
 *   - Multiple rule sets per plan
 *   - Per-rule include/exclude
 *   - Nested parent-child rules
 *   - Tag matching
 *   - Time-bound rules
 *   - Conditional logic
 *
 * Precedence per §22.6:
 *   1. If ANY include rule set defines includes → txn must match at least one include
 *   2. If ANY exclude rule matches → txn is excluded (overrides includes)
 */
export function applyMappingFilters(db, transactions, ruleSets, tagContext = null, asOf = null) {
  if (!ruleSets || ruleSets.length === 0) return transactions;
  const today = asOf || new Date().toISOString().split('T')[0];

  // Flatten rules, separating include and exclude
  const allRules = [];
  for (const rs of ruleSets) {
    for (const r of rs.rules || []) allRules.push(r);
  }
  const topLevelRules = allRules.filter(r => !r.parent_rule_id);
  const includeRules = topLevelRules.filter(r => r.rule_type === 'include');
  const excludeRules = topLevelRules.filter(r => r.rule_type === 'exclude');

  return transactions.filter(txn => {
    // Exclude rules always take precedence
    for (const rule of excludeRules) {
      if (ruleMatchesRecursive(rule, allRules, txn, tagContext, today)) {
        return false;
      }
    }
    // If there are any include rules, txn must match at least one
    if (includeRules.length > 0) {
      return includeRules.some(rule => ruleMatchesRecursive(rule, allRules, txn, tagContext, today));
    }
    // No include rules = everything passes (unless excluded above)
    return true;
  });
}

/**
 * Build a tag lookup context for a calculation run. Called once per run to
 * avoid N+1 queries during rule evaluation.
 */
export async function buildTagContext(db) {
  const rows = await db.prepare('SELECT tag_id, entity_type, entity_id, valid_from, valid_to FROM entity_tags').all();
  const today = new Date().toISOString().split('T')[0];
  const productTags = {};
  const customerTags = {};
  const territoryTags = {};

  for (const row of rows) {
    // Respect time bounds on tag assignment
    if (row.valid_from && today < row.valid_from) continue;
    if (row.valid_to && today > row.valid_to) continue;

    const target = row.entity_type === 'product' ? productTags
      : row.entity_type === 'customer' ? customerTags
      : row.entity_type === 'territory' ? territoryTags
      : null;
    if (!target) continue;
    if (!target[row.entity_id]) target[row.entity_id] = [];
    target[row.entity_id].push(row.tag_id);
  }
  return { productTags, customerTags, territoryTags };
}
