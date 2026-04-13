import { useState, useEffect } from 'react';
import api from '../api/client';
import toast from 'react-hot-toast';
import { Target, Search, TrendingUp, TrendingDown, Filter, AlertCircle, Plus, Pencil, Trash2, X } from 'lucide-react';
import { cn } from '../lib/utils';
import FormulaBuilder from '../components/FormulaBuilder';

const categoryColors = {
  Revenue: 'bg-emerald-100 text-emerald-800',
  Volume: 'bg-blue-100 text-blue-800',
  Distribution: 'bg-violet-100 text-violet-800',
  Collection: 'bg-amber-100 text-amber-800',
  Returns: 'bg-rose-100 text-rose-800',
  'Product Mix': 'bg-cyan-100 text-cyan-800',
  Customer: 'bg-orange-100 text-orange-800',
  Team: 'bg-indigo-100 text-indigo-800',
  Efficiency: 'bg-teal-100 text-teal-800',
  Compliance: 'bg-slate-100 text-slate-800',
  Profitability: 'bg-green-100 text-green-800',
};

const defaultFormula = { type: 'simple', aggregation: 'SUM', field: 'amount', transactionType: 'sale', filters: [] };

const emptyKpi = {
  name: '', code: '', category: 'Revenue', description: '',
  formula: defaultFormula,
  unit: 'currency', direction: 'higher_is_better', applicable_roles: [],
};

/** Parse formula from JSON string to object, with legacy fallback */
function parseFormulaValue(formula) {
  if (!formula) return defaultFormula;
  if (typeof formula === 'object' && formula.type) return formula;
  if (typeof formula === 'string') {
    try {
      const parsed = JSON.parse(formula);
      if (parsed && typeof parsed === 'object' && parsed.type) return parsed;
    } catch {}
  }
  return defaultFormula; // Legacy text formula — use default
}

/** Human-readable formula preview for KPI cards */
function formulaPreviewText(formula) {
  const f = parseFormulaValue(formula);
  if (!f || !f.type) return typeof formula === 'string' ? formula : '';
  const mp = (m) => {
    if (!m) return '...';
    const filters = (m.filters || []).map(fl => `${fl.field}${fl.operator}${typeof fl.value === 'object' ? JSON.stringify(fl.value) : fl.value}`);
    const where = [m.transactionType && m.transactionType !== 'all' ? `type=${m.transactionType}` : '', ...filters].filter(Boolean).join(' AND ');
    return `${m.aggregation || 'SUM'}(${m.field || 'amount'})${where ? ' WHERE ' + where : ''}`;
  };
  switch (f.type) {
    case 'simple': return mp(f);
    case 'ratio': return `(${mp(f.numerator)} / ${mp(f.denominator)})${f.multiplyBy && f.multiplyBy !== 1 ? ' ×' + f.multiplyBy : ''}`;
    case 'growth': return `Growth: ${mp(f.baseMetric)} vs ${(f.compareWith || 'previous_year').replace(/_/g, ' ')}`;
    case 'team': return `Team ${f.teamAggregation || 'SUM'}: ${mp(f.baseMetric)}`;
    case 'static': return `Static: ${f.defaultValue ?? 0}`;
    default: return '';
  }
}

const roleOptions = [
  { id: 'role-sr', label: 'SR' },
  { id: 'role-ss', label: 'SS' },
  { id: 'role-asm', label: 'ASM' },
  { id: 'role-rsm', label: 'RSM' },
  { id: 'role-nsm', label: 'NSM' },
  { id: 'role-kam', label: 'KAM' },
];

export default function KpiLibraryPage() {
  const [kpis, setKpis] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingKpi, setEditingKpi] = useState(null);
  const [form, setForm] = useState({ ...emptyKpi });
  const [saving, setSaving] = useState(false);

  const loadKpis = () => {
    Promise.all([api.get('/kpis'), api.get('/kpis/categories')])
      .then(([kpiData, cats]) => {
        setKpis(kpiData);
        setCategories(['All', ...cats]);
      })
      .catch(() => setError('Failed to load KPIs'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadKpis(); }, []);

  const openCreate = () => {
    setEditingKpi(null);
    setForm({ ...emptyKpi });
    setModalOpen(true);
  };

  const openEdit = (kpi) => {
    setEditingKpi(kpi);
    const roles = typeof kpi.applicable_roles === 'string' ? JSON.parse(kpi.applicable_roles) : kpi.applicable_roles;
    setForm({ ...kpi, applicable_roles: roles || [], formula: parseFormulaValue(kpi.formula) });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.code) {
      return toast.error('Name and code are required');
    }
    if (!form.formula || !form.formula.type) {
      return toast.error('Please configure a formula');
    }
    setSaving(true);
    try {
      const payload = { ...form, formula: JSON.stringify(form.formula) };
      if (editingKpi) {
        await api.put(`/kpis/${editingKpi.id}`, payload);
        toast.success('KPI updated');
      } else {
        await api.post('/kpis', payload);
        toast.success('KPI created');
      }
      setModalOpen(false);
      loadKpis();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (kpi) => {
    if (!confirm(`Delete "${kpi.name}"?`)) return;
    try {
      await api.delete(`/kpis/${kpi.id}`);
      toast.success('KPI deleted');
      loadKpis();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const filtered = kpis.filter(kpi => {
    if (selectedCategory !== 'All' && kpi.category !== selectedCategory) return false;
    if (search && !kpi.name.toLowerCase().includes(search.toLowerCase()) && !kpi.code.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-slate-200 rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="card p-6 space-y-3">
              <div className="h-5 w-32 bg-slate-200 rounded animate-pulse" />
              <div className="h-4 w-full bg-slate-100 rounded animate-pulse" />
              <div className="h-4 w-3/4 bg-slate-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-12 text-center">
        <AlertCircle className="w-12 h-12 text-rose-300 mx-auto mb-3" />
        <h3 className="text-lg font-medium text-slate-700 mb-1">Failed to Load KPIs</h3>
        <p className="text-slate-500 mb-4">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">KPI Library</h1>
          <p className="text-slate-500 mt-1">{kpis.length} KPI definitions across {categories.length - 1} categories</p>
        </div>
        <button onClick={openCreate} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" /> New KPI
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search KPIs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-10"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-2">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              selectedCategory === cat
                ? 'bg-primary-600 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            )}
          >
            {cat}
            {cat !== 'All' && (
              <span className="ml-1.5 text-xs opacity-70">
                ({kpis.filter(k => k.category === cat).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(kpi => {
          const roles = typeof kpi.applicable_roles === 'string' ? JSON.parse(kpi.applicable_roles) : kpi.applicable_roles;
          return (
            <div key={kpi.id} className="card p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className={cn('badge', categoryColors[kpi.category] || 'badge-gray')}>
                  {kpi.category}
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(kpi)} className="p-1 hover:bg-slate-100 rounded" title="Edit">
                    <Pencil className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                  <button onClick={() => handleDelete(kpi)} className="p-1 hover:bg-rose-50 rounded" title="Delete">
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  </button>
                  {kpi.direction === 'higher_is_better' ? (
                    <TrendingUp className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-rose-500" />
                  )}
                </div>
              </div>

              <h3 className="font-semibold text-slate-900 mb-1">{kpi.name}</h3>
              <p className="text-xs font-mono text-slate-400 mb-2">{kpi.code}</p>
              <p className="text-sm text-slate-600 mb-3">{kpi.description}</p>

              <div className="pt-3 border-t border-slate-100">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-slate-400">Unit:</span>
                  <span className="badge badge-gray">{kpi.unit}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Formula:</span>
                  <span className="text-xs text-slate-500 font-mono truncate" title={formulaPreviewText(kpi.formula)}>{formulaPreviewText(kpi.formula)}</span>
                </div>
              </div>

              {roles.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <span className="text-xs text-slate-400 block mb-1.5">Applicable Roles:</span>
                  <div className="flex flex-wrap gap-1">
                    {roles.map(r => (
                      <span key={r} className="text-xs bg-primary-50 text-primary-700 px-1.5 py-0.5 rounded">
                        {r.replace('role-', '').toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12">
          <Target className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500">No KPIs match your filters</p>
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">{editingKpi ? 'Edit KPI' : 'New KPI'}</h2>
              <button onClick={() => setModalOpen(false)} className="p-1 hover:bg-slate-100 rounded"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">Name</label>
                <input className="input" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g., Net Revenue" />
              </div>
              <div>
                <label className="label">Code</label>
                <input className="input font-mono" value={form.code} onChange={e => setForm({...form, code: e.target.value})} placeholder="e.g., NET_REVENUE" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Category</label>
                  <select className="input" value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
                    {Object.keys(categoryColors).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Unit</label>
                  <select className="input" value={form.unit} onChange={e => setForm({...form, unit: e.target.value})}>
                    <option value="currency">Currency</option>
                    <option value="percentage">Percentage</option>
                    <option value="number">Number</option>
                    <option value="count">Count</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input min-h-[60px]" value={form.description || ''} onChange={e => setForm({...form, description: e.target.value})} />
              </div>
              <div>
                <label className="label">Formula</label>
                <FormulaBuilder value={form.formula} onChange={(f) => setForm({...form, formula: f})} />
              </div>
              <div>
                <label className="label">Direction</label>
                <select className="input" value={form.direction} onChange={e => setForm({...form, direction: e.target.value})}>
                  <option value="higher_is_better">Higher is Better</option>
                  <option value="lower_is_better">Lower is Better</option>
                </select>
              </div>
              <div>
                <label className="label">Applicable Roles</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {roleOptions.map(r => {
                    const sel = form.applicable_roles.includes(r.id);
                    return (
                      <button key={r.id} type="button"
                        className={cn('px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                          sel ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                        )}
                        onClick={() => {
                          const newRoles = sel ? form.applicable_roles.filter(x => x !== r.id) : [...form.applicable_roles, r.id];
                          setForm({...form, applicable_roles: newRoles});
                        }}
                      >
                        {r.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-200">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                {saving ? 'Saving...' : editingKpi ? 'Update KPI' : 'Create KPI'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
