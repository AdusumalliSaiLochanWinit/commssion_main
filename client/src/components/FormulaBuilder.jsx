import { useState, useEffect } from 'react';
import { Plus, Trash2, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';
import api from '../api/client';

const AGGREGATIONS = [
  { value: 'SUM', label: 'SUM' },
  { value: 'COUNT_DISTINCT', label: 'COUNT DISTINCT' },
  { value: 'AVG', label: 'AVG' },
  { value: 'COUNT', label: 'COUNT' },
];

const FIELDS = [
  { value: 'amount', label: 'Amount' },
  { value: 'quantity', label: 'Quantity' },
  { value: 'customer_id', label: 'Customer ID' },
  { value: 'product_id', label: 'Product ID' },
];

const TX_TYPES = [
  { value: 'sale', label: 'Sale' },
  { value: 'return', label: 'Return' },
  { value: 'collection', label: 'Collection' },
  { value: 'all', label: 'All' },
];

const FILTER_FIELDS = [
  { value: 'product_category', label: 'Product Category' },
  { value: 'product_sku', label: 'Product (SKU)' },
  { value: 'is_strategic', label: 'Is Strategic' },
  { value: 'is_new_launch', label: 'Is New Launch' },
  { value: 'customer_channel', label: 'Customer Channel' },
  { value: 'customer_group', label: 'Customer Group' },
];

const FILTER_OPERATORS = [
  { value: '=', label: '=' },
  { value: '!=', label: '!=' },
  { value: 'in', label: 'IN' },
  { value: 'not_in', label: 'NOT IN' },
];

const FORMULA_TYPES = [
  { value: 'simple', label: 'Simple', desc: 'Aggregate filtered transactions' },
  { value: 'ratio', label: 'Ratio', desc: 'Numerator / Denominator' },
  { value: 'growth', label: 'Growth', desc: 'Current vs previous period' },
  { value: 'team', label: 'Team', desc: 'Aggregate direct reports' },
  { value: 'static', label: 'Static', desc: 'Fixed value / external' },
];

const COMPARE_OPTIONS = [
  { value: 'previous_year', label: 'Previous Year' },
  { value: 'previous_month', label: 'Previous Month' },
];

const TEAM_AGG_OPTIONS = [
  { value: 'SUM', label: 'SUM' },
  { value: 'AVG', label: 'AVG' },
  { value: 'COUNT', label: 'COUNT' },
];

const defaultMetric = () => ({
  aggregation: 'SUM',
  field: 'amount',
  transactionType: 'sale',
  filters: [],
});

const defaultFormula = () => ({
  type: 'simple',
  aggregation: 'SUM',
  field: 'amount',
  transactionType: 'sale',
  filters: [],
});

// Fields that have dynamic lookup values
const LOOKUP_FIELDS = ['product_category', 'product_sku', 'customer_channel', 'customer_group', 'is_strategic', 'is_new_launch'];

function FilterValueInput({ field, operator, value, onChange }) {
  const [options, setOptions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const isMulti = operator === 'in' || operator === 'not_in';

  useEffect(() => {
    if (LOOKUP_FIELDS.includes(field)) {
      api.get(`/lookups/filter-values?field=${field}`)
        .then(data => { setOptions(data); setLoaded(true); })
        .catch(() => setLoaded(true));
    }
  }, [field]);

  // For IN/NOT_IN operators, show multi-select checkboxes
  if (isMulti && loaded && options.length > 0) {
    const selected = Array.isArray(value) ? value : value ? [value] : [];
    return (
      <div className="flex-1">
        <select
          className="input text-xs"
          multiple
          size={Math.min(options.length, 4)}
          value={selected.map(String)}
          onChange={e => {
            const vals = Array.from(e.target.selectedOptions).map(o => {
              const v = o.value;
              return !isNaN(v) && v !== '' ? Number(v) : v;
            });
            onChange(vals);
          }}
        >
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    );
  }

  // For = / != with lookup values, show a dropdown
  if (loaded && options.length > 0) {
    return (
      <select
        className="input text-xs flex-1"
        value={value ?? ''}
        onChange={e => {
          let v = e.target.value;
          if (!isNaN(v) && v !== '') v = Number(v);
          onChange(v);
        }}
      >
        <option value="">-- select --</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  // Fallback: free text input
  return (
    <input
      className="input text-xs flex-1"
      value={typeof value === 'object' ? JSON.stringify(value) : value ?? ''}
      onChange={e => {
        let val = e.target.value;
        if (!isNaN(val) && val !== '') val = Number(val);
        else {
          try { const parsed = JSON.parse(val); if (Array.isArray(parsed)) val = parsed; } catch {}
        }
        onChange(val);
      }}
      placeholder="value"
    />
  );
}

function MetricBlock({ metric, onChange, label }) {
  const update = (key, val) => onChange({ ...metric, [key]: val });

  const addFilter = () => {
    onChange({ ...metric, filters: [...(metric.filters || []), { field: 'product_category', operator: '=', value: '' }] });
  };

  const updateFilter = (idx, key, val) => {
    const filters = [...(metric.filters || [])];
    filters[idx] = { ...filters[idx], [key]: val };
    // Reset value when field changes
    if (key === 'field') filters[idx].value = '';
    onChange({ ...metric, filters });
  };

  const removeFilter = (idx) => {
    onChange({ ...metric, filters: (metric.filters || []).filter((_, i) => i !== idx) });
  };

  return (
    <div className="border border-neutral-200 rounded-lg p-3 space-y-3 bg-neutral-50/50">
      {label && <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">{label}</div>}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="text-xs text-neutral-400">Aggregation</label>
          <select className="input text-sm" value={metric.aggregation} onChange={e => update('aggregation', e.target.value)}>
            {AGGREGATIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-neutral-400">Field</label>
          <select className="input text-sm" value={metric.field} onChange={e => update('field', e.target.value)}>
            {FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-neutral-400">Transaction Type</label>
          <select className="input text-sm" value={metric.transactionType} onChange={e => update('transactionType', e.target.value)}>
            {TX_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {/* Filters */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-neutral-400">Filters (product/customer hierarchy)</span>
          <button type="button" onClick={addFilter} className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5">
            <Plus className="w-3 h-3" /> Add Filter
          </button>
        </div>
        {(metric.filters || []).map((f, idx) => (
          <div key={idx} className="flex items-center gap-1.5 mb-1.5">
            <select className="input text-xs w-36" value={f.field} onChange={e => updateFilter(idx, 'field', e.target.value)}>
              {FILTER_FIELDS.map(ff => <option key={ff.value} value={ff.value}>{ff.label}</option>)}
            </select>
            <select className="input text-xs w-16" value={f.operator} onChange={e => updateFilter(idx, 'operator', e.target.value)}>
              {FILTER_OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <FilterValueInput
              field={f.field}
              operator={f.operator}
              value={f.value}
              onChange={val => updateFilter(idx, 'value', val)}
            />
            <button type="button" onClick={() => removeFilter(idx)} className="p-1 hover:bg-rose-50 rounded">
              <Trash2 className="w-3 h-3 text-rose-400" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function FormulaPreview({ formula }) {
  const text = formulaToPreview(formula);
  return (
    <div className="bg-neutral-900 text-emerald-400 rounded-lg px-3 py-2 font-mono text-xs leading-relaxed">
      {text || <span className="text-neutral-500">Configure formula above...</span>}
    </div>
  );
}

function formulaToPreview(formula) {
  if (!formula || !formula.type) return '';
  switch (formula.type) {
    case 'simple':
      return metricPreview(formula);
    case 'ratio': {
      const n = metricPreview(formula.numerator);
      const d = metricPreview(formula.denominator);
      const mult = formula.multiplyBy && formula.multiplyBy !== 1 ? ` × ${formula.multiplyBy}` : '';
      return `(${n} / ${d})${mult}`;
    }
    case 'growth':
      return `Growth of ${metricPreview(formula.baseMetric)} vs ${(formula.compareWith || 'previous_year').replace(/_/g, ' ')}`;
    case 'team':
      return `${formula.teamAggregation || 'SUM'} of team's ${metricPreview(formula.baseMetric)}`;
    case 'static':
      return `Static: ${formula.defaultValue ?? 0}${formula.source ? ` (${formula.source})` : ''}`;
    default:
      return '';
  }
}

function metricPreview(m) {
  if (!m) return '...';
  const filters = (m.filters || []).map(f => `${f.field}${f.operator}${typeof f.value === 'object' ? JSON.stringify(f.value) : f.value}`);
  const where = [
    m.transactionType && m.transactionType !== 'all' ? `type=${m.transactionType}` : '',
    ...filters,
  ].filter(Boolean).join(' AND ');
  return `${m.aggregation || 'SUM'}(${m.field || 'amount'})${where ? ' WHERE ' + where : ''}`;
}

export default function FormulaBuilder({ value, onChange }) {
  const formula = value && typeof value === 'object' && value.type ? value : defaultFormula();

  const setType = (type) => {
    switch (type) {
      case 'simple':
        onChange({ type: 'simple', ...defaultMetric() });
        break;
      case 'ratio':
        onChange({ type: 'ratio', numerator: defaultMetric(), denominator: defaultMetric(), multiplyBy: 1 });
        break;
      case 'growth':
        onChange({ type: 'growth', baseMetric: defaultMetric(), compareWith: 'previous_year' });
        break;
      case 'team':
        onChange({ type: 'team', baseMetric: defaultMetric(), teamAggregation: 'SUM' });
        break;
      case 'static':
        onChange({ type: 'static', defaultValue: 0, source: 'external' });
        break;
    }
  };

  return (
    <div className="space-y-3">
      {/* Type selector */}
      <div>
        <label className="label">Formula Type</label>
        <div className="flex flex-wrap gap-1.5">
          {FORMULA_TYPES.map(ft => (
            <button
              key={ft.value}
              type="button"
              onClick={() => setType(ft.value)}
              className={cn(
                'px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                formula.type === ft.value
                  ? 'bg-primary-50 border-primary-300 text-primary-700'
                  : 'bg-white border-neutral-200 text-neutral-500 hover:bg-neutral-50'
              )}
              title={ft.desc}
            >
              {ft.label}
            </button>
          ))}
        </div>
      </div>

      {/* Type-specific config */}
      {formula.type === 'simple' && (
        <MetricBlock
          metric={formula}
          onChange={(m) => onChange({ ...m, type: 'simple' })}
        />
      )}

      {formula.type === 'ratio' && (
        <div className="space-y-2">
          <MetricBlock
            label="Numerator"
            metric={formula.numerator || defaultMetric()}
            onChange={(m) => onChange({ ...formula, numerator: m })}
          />
          <div className="flex items-center justify-center">
            <div className="h-px flex-1 bg-neutral-200" />
            <span className="px-2 text-xs text-neutral-400 font-medium">÷ divided by</span>
            <div className="h-px flex-1 bg-neutral-200" />
          </div>
          <MetricBlock
            label="Denominator"
            metric={formula.denominator || defaultMetric()}
            onChange={(m) => onChange({ ...formula, denominator: m })}
          />
          <div>
            <label className="text-xs text-neutral-400">Multiply by</label>
            <input
              type="number"
              className="input text-sm w-24"
              value={formula.multiplyBy ?? 1}
              onChange={e => onChange({ ...formula, multiplyBy: Number(e.target.value) || 1 })}
            />
          </div>
        </div>
      )}

      {formula.type === 'growth' && (
        <div className="space-y-2">
          <MetricBlock
            label="Base Metric"
            metric={formula.baseMetric || defaultMetric()}
            onChange={(m) => onChange({ ...formula, baseMetric: m })}
          />
          <div>
            <label className="text-xs text-neutral-400">Compare with</label>
            <select
              className="input text-sm"
              value={formula.compareWith || 'previous_year'}
              onChange={e => onChange({ ...formula, compareWith: e.target.value })}
            >
              {COMPARE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {formula.type === 'team' && (
        <div className="space-y-2">
          <MetricBlock
            label="Per-member Metric"
            metric={formula.baseMetric || defaultMetric()}
            onChange={(m) => onChange({ ...formula, baseMetric: m })}
          />
          <div>
            <label className="text-xs text-neutral-400">Team Aggregation</label>
            <select
              className="input text-sm"
              value={formula.teamAggregation || 'SUM'}
              onChange={e => onChange({ ...formula, teamAggregation: e.target.value })}
            >
              {TEAM_AGG_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {formula.type === 'static' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-neutral-400">Default Value</label>
            <input
              type="number"
              className="input text-sm"
              value={formula.defaultValue ?? 0}
              onChange={e => onChange({ ...formula, defaultValue: Number(e.target.value) || 0 })}
            />
          </div>
          <div>
            <label className="text-xs text-neutral-400">Source</label>
            <select
              className="input text-sm"
              value={formula.source || 'external'}
              onChange={e => onChange({ ...formula, source: e.target.value })}
            >
              <option value="external">External</option>
              <option value="manual">Manual</option>
              <option value="placeholder">Placeholder</option>
            </select>
          </div>
        </div>
      )}

      {/* Preview */}
      <FormulaPreview formula={formula} />
    </div>
  );
}
