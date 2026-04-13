import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAppStore } from '../store/store';
import toast from 'react-hot-toast';
import { cn, formatCurrency, getStatusColor, getStatusLabel } from '../lib/utils';
import {
  ArrowLeft, Settings, Target, BarChart3, Filter, ShieldCheck,
  Zap, AlertTriangle, ArrowUpDown, Scissors, Save, ChevronDown,
  Sparkles, AlertCircle, Plus, Trash2, X, Wand2, Scale, Info, CheckCircle2,
  Truck, Users
} from 'lucide-react';

// ==================== KPI CONFIG HELPER DATA ====================
// Role-based preset templates — one-click to build a complete KPI set
const KPI_PRESETS = {
  'pre-sales': {
    label: 'Pre-Sales Representative',
    description: 'Order booking + delivered value + collection focus',
    kpis: [
      { code: 'TOTAL_REVENUE',     weight: 40, target: 50000 },
      { code: 'UNITS_SOLD',        weight: 15, target: 5000 },
      { code: 'COLLECTION_PERCENT',weight: 15, target: 85 },
      { code: 'OUTLET_COVERAGE',   weight: 10, target: 50 },
      { code: 'LINES_PER_CALL',    weight: 10, target: 5 },
      { code: 'RETURN_PERCENT',    weight: 10, target: 5 },
    ],
  },
  'van-sales': {
    label: 'Van Sales Representative',
    description: 'Per-drop sales + strike rate + collection compliance',
    kpis: [
      { code: 'TOTAL_REVENUE',     weight: 30, target: 60000 },
      { code: 'UNITS_SOLD',        weight: 20, target: 8000 },
      { code: 'STRIKE_RATE',       weight: 15, target: 70 },
      { code: 'OUTLET_COVERAGE',   weight: 10, target: 60 },
      { code: 'COLLECTION_PERCENT',weight: 15, target: 90 },
      { code: 'RETURN_PERCENT',    weight: 10, target: 4 },
    ],
  },
  'delivery': {
    label: 'Delivery Driver',
    description: 'Per-drop, on-time, zero-complaint, GPS-validated',
    kpis: [
      { code: 'PER_DROP',         weight: 30, target: 150 },
      { code: 'OTD_PERCENT',      weight: 25, target: 95 },
      { code: 'ZERO_COMPLAINT',   weight: 15, target: 97 },
      { code: 'DAMAGE_FREE',      weight: 15, target: 98 },
      { code: 'ROUTE_COMPLETION', weight: 15, target: 95 },
    ],
  },
  'merchandiser': {
    label: 'Merchandiser',
    description: 'Planogram + shelf share + OOS reduction + visibility',
    kpis: [
      { code: 'PLANOGRAM',           weight: 25, target: 85 },
      { code: 'SHELF_SHARE',         weight: 20, target: 30 },
      { code: 'OOS_REDUCTION',       weight: 20, target: 25 },
      { code: 'FACING_COMPLIANCE',   weight: 15, target: 85 },
      { code: 'IMAGE_VERIFY',        weight: 10, target: 92 },
      { code: 'COMPETITOR_REPORT',   weight: 10, target: 85 },
    ],
  },
  'trade-mkt': {
    label: 'Trade Marketing Executive',
    description: 'Campaign execution + promo compliance + launch activation',
    kpis: [
      { code: 'CAMPAIGN_EXEC',      weight: 25, target: 90 },
      { code: 'PROMO_COMPLIANCE',   weight: 20, target: 88 },
      { code: 'PROMO_SELLOUT',      weight: 20, target: 82 },
      { code: 'LAUNCH_COMPLIANCE',  weight: 15, target: 85 },
      { code: 'DISPLAY_DURATION',   weight: 10, target: 87 },
      { code: 'ACTIVATION_REPORT',  weight: 10, target: 93 },
    ],
  },
  'key-account': {
    label: 'Key Account Executive',
    description: 'Strategic SKU push + premium growth + KA revenue',
    kpis: [
      { code: 'TOTAL_REVENUE',      weight: 35, target: 150000 },
      { code: 'STRATEGIC_SKU_REV',  weight: 25, target: 50000 },
      { code: 'PREMIUM_SKU_GROWTH', weight: 15, target: 15 },
      { code: 'COLLECTION_PERCENT', weight: 15, target: 90 },
      { code: 'NEW_LAUNCH_SALES',   weight: 10, target: 20000 },
    ],
  },
  'supervisor': {
    label: 'Sales Supervisor / ASM',
    description: 'Team revenue + coverage + team target achievement',
    kpis: [
      { code: 'TEAM_REVENUE',       weight: 40, target: 300000 },
      { code: 'TEAM_TARGET_ACH',    weight: 25, target: 90 },
      { code: 'BEAT_COMPLIANCE',    weight: 15, target: 90 },
      { code: 'ACTIVE_OUTLET_GROWTH', weight: 10, target: 12 },
      { code: 'DSO',                weight: 10, target: 28 },
    ],
  },
};

// Smart target suggestions based on KPI unit + direction
function suggestTarget(kpi) {
  if (!kpi) return 0;
  if (kpi.unit === 'percentage') return kpi.direction === 'lower_is_better' ? 5 : 85;
  if (kpi.unit === 'currency') return 50000;
  if (kpi.unit === 'number') return 50;
  return 0;
}

const tabs = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'kpis', label: 'KPIs & Weights', icon: Target },
  { id: 'helper-trips', label: 'Helper Trips', icon: Truck },
  { id: 'slabs', label: 'Slabs', icon: BarChart3 },
  { id: 'rules', label: 'Product & Customer Scope', icon: Filter },
  { id: 'eligibility', label: 'Eligibility', icon: ShieldCheck },
  { id: 'multipliers', label: 'Multipliers', icon: Zap },
  { id: 'penalties', label: 'Penalties', icon: AlertTriangle },
  { id: 'caps', label: 'Caps & Splits', icon: Scissors },
];

export default function PlanBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [plan, setPlan] = useState(null);
  const [activeTab, setActiveTab] = useState('general');
  const [loading, setLoading] = useState(!!id);
  const [allRoles, setAllRoles] = useState([]);
  const [allTerritories, setAllTerritories] = useState([]);
  const [allKpis, setAllKpis] = useState([]);

  useEffect(() => {
    const loads = [
      api.get('/roles'),
      api.get('/territories'),
      api.get('/kpis'),
    ];
    if (id && id !== 'new') loads.push(api.get(`/plans/${id}`));

    Promise.all(loads).then(([roles, territories, kpis, planData]) => {
      setAllRoles(roles);
      setAllTerritories(territories);
      setAllKpis(kpis);
      if (planData) setPlan(planData);
      else setPlan({
        name: '', description: '', status: 'draft', plan_type: 'monthly',
        effective_from: '2026-01-01', effective_to: '2026-12-31', base_payout: 15000,
        roles: [], territories: [], kpis: [], slab_sets: [], rule_sets: [],
        eligibility_rules: [], multiplier_rules: [], penalty_rules: [],
        capping_rules: [], split_rules: [],
      });
    }).catch(() => {
      toast.error('Failed to load plan data');
    }).finally(() => setLoading(false));
  }, [id]);

  if (loading || !plan) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-slate-200 rounded animate-pulse" />
        <div className="card p-8">
          <div className="h-96 bg-slate-100 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <button onClick={() => navigate('/plans')} className="p-2 hover:bg-slate-100 rounded-lg transition-colors self-start">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">
            {plan.id ? plan.name : 'New Commission Plan'}
          </h1>
          {plan.id && (
            <div className="flex items-center gap-3 mt-1">
              <span className={cn('badge', getStatusColor(plan.status))}>{getStatusLabel(plan.status)}</span>
              <span className="text-sm text-slate-500">{plan.plan_type}</span>
            </div>
          )}
        </div>
        {plan.id && plan.status === 'draft' && (
          <button
            onClick={async () => {
              try {
                await api.put(`/plans/${plan.id}`, { status: 'active', updated_by: 'admin' });
                setPlan({ ...plan, status: 'active' });
                toast.success('Plan activated — now available in Calculate');
              } catch (err) {
                toast.error(err.message);
              }
            }}
            className="btn-primary flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700"
          >
            <CheckCircle2 className="w-4 h-4" />
            Activate Plan
          </button>
        )}
        {plan.id && plan.status === 'active' && (
          <button
            onClick={async () => {
              if (!confirm('Move this plan back to draft? It will no longer appear in Calculate.')) return;
              try {
                await api.put(`/plans/${plan.id}`, { status: 'draft', updated_by: 'admin' });
                setPlan({ ...plan, status: 'draft' });
                toast.success('Plan moved to draft');
              } catch (err) {
                toast.error(err.message);
              }
            }}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 flex items-center gap-2"
          >
            Move to Draft
          </button>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-slate-200">
        <div className="flex gap-1 overflow-x-auto pb-px">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="card p-6">
        {activeTab === 'general' && <GeneralTab plan={plan} setPlan={setPlan} allRoles={allRoles} allTerritories={allTerritories} navigate={navigate} />}
        {activeTab === 'kpis' && <KpisTab plan={plan} setPlan={setPlan} allKpis={allKpis} />}
        {activeTab === 'helper-trips' && <HelperTripsTab plan={plan} />}
        {activeTab === 'slabs' && <SlabsTab plan={plan} setPlan={setPlan} allKpis={allKpis} />}
        {activeTab === 'rules' && <RulesTab plan={plan} setPlan={setPlan} />}
        {activeTab === 'eligibility' && <EligibilityTab plan={plan} setPlan={setPlan} />}
        {activeTab === 'multipliers' && <MultipliersTab plan={plan} setPlan={setPlan} />}
        {activeTab === 'penalties' && <PenaltiesTab plan={plan} setPlan={setPlan} />}
        {activeTab === 'caps' && <CapsTab plan={plan} setPlan={setPlan} allRoles={allRoles} />}
      </div>
    </div>
  );
}

// ====== TAB COMPONENTS ======

function GeneralTab({ plan, setPlan, allRoles, allTerritories, navigate }) {
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!plan.name) return toast.error('Plan name is required');
    setSaving(true);
    try {
      if (!plan.id) {
        const created = await api.post('/plans', {
          name: plan.name, description: plan.description, plan_type: plan.plan_type,
          effective_from: plan.effective_from, effective_to: plan.effective_to,
          base_payout: plan.base_payout, created_by: 'admin',
        });
        // Save roles and territories
        if (plan.roles.length > 0) await api.put(`/plans/${created.id}/roles`, { role_ids: plan.roles.map(r => r.id) });
        if (plan.territories.length > 0) await api.put(`/plans/${created.id}/territories`, { territory_ids: plan.territories.map(t => t.id) });
        toast.success('Plan created');
        navigate(`/plans/${created.id}`);
      } else {
        await api.put(`/plans/${plan.id}`, {
          name: plan.name, description: plan.description, status: plan.status,
          plan_type: plan.plan_type, effective_from: plan.effective_from,
          effective_to: plan.effective_to, base_payout: plan.base_payout, updated_by: 'admin',
        });
        await api.put(`/plans/${plan.id}/roles`, { role_ids: plan.roles.map(r => r.id) });
        await api.put(`/plans/${plan.id}/territories`, { territory_ids: plan.territories.map(t => t.id) });
        toast.success('Plan saved');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <label className="label">Plan Name</label>
        <input className="input" value={plan.name} onChange={e => setPlan({...plan, name: e.target.value})} placeholder="e.g., Field Sales Monthly Incentive" />
      </div>
      <div>
        <label className="label">Description</label>
        <textarea className="input min-h-[80px]" value={plan.description || ''} onChange={e => setPlan({...plan, description: e.target.value})} placeholder="Describe the plan purpose..." />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Plan Type</label>
          <select className="input" value={plan.plan_type} onChange={e => setPlan({...plan, plan_type: e.target.value})}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
          </select>
        </div>
        <div>
          <label className="label">Base Payout</label>
          <input type="number" className="input" value={plan.base_payout} onChange={e => setPlan({...plan, base_payout: Number(e.target.value)})} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Effective From</label>
          <input type="date" className="input" value={plan.effective_from} onChange={e => setPlan({...plan, effective_from: e.target.value})} />
        </div>
        <div>
          <label className="label">Effective To</label>
          <input type="date" className="input" value={plan.effective_to} onChange={e => setPlan({...plan, effective_to: e.target.value})} />
        </div>
      </div>
      <div>
        <label className="label">Status</label>
        <select className="input max-w-xs" value={plan.status} onChange={e => setPlan({...plan, status: e.target.value})}>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Applicable Roles */}
      <div>
        <label className="label">Applicable Roles</label>
        <div className="flex flex-wrap gap-2 mt-2">
          {allRoles.map(role => {
            const selected = plan.roles?.some(r => r.id === role.id);
            return (
              <button
                key={role.id}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                  selected ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                )}
                onClick={() => {
                  const newRoles = selected
                    ? plan.roles.filter(r => r.id !== role.id)
                    : [...(plan.roles || []), role];
                  setPlan({...plan, roles: newRoles});
                }}
              >
                {role.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Territories */}
      <div>
        <label className="label">Territories</label>
        <div className="flex flex-wrap gap-2 mt-2">
          {allTerritories.map(terr => {
            const selected = plan.territories?.some(t => t.id === terr.id);
            return (
              <button
                key={terr.id}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                  selected ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                )}
                onClick={() => {
                  const newTerrs = selected
                    ? plan.territories.filter(t => t.id !== terr.id)
                    : [...(plan.territories || []), terr];
                  setPlan({...plan, territories: newTerrs});
                }}
              >
                {terr.name}
                <span className="ml-1 text-xs opacity-60">({terr.type})</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="pt-4 border-t border-slate-200">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save General'}
        </button>
      </div>
    </div>
  );
}

function KpisTab({ plan, setPlan, allKpis }) {
  const [saving, setSaving] = useState(false);
  const planKpis = plan.kpis || [];
  const totalWeight = planKpis.reduce((s, k) => s + Number(k.weight || 0), 0);
  const [addKpiId, setAddKpiId] = useState('');
  const [helperOpen, setHelperOpen] = useState(planKpis.length === 0);
  const [categoryFilter, setCategoryFilter] = useState('all');

  // Group KPIs by category for the browse view
  const kpisByCategory = allKpis.reduce((acc, k) => {
    (acc[k.category] = acc[k.category] || []).push(k);
    return acc;
  }, {});
  const categories = ['all', ...Object.keys(kpisByCategory).sort()];

  const addKpi = (kpiId = addKpiId, customWeight = 0, customTarget = null) => {
    const id = kpiId || addKpiId;
    if (!id) return;
    if (planKpis.some(k => k.kpi_id === id)) {
      toast.error('KPI already added');
      return;
    }
    const kpi = allKpis.find(k => k.id === id);
    if (!kpi) return;
    const target = customTarget != null ? customTarget : suggestTarget(kpi);
    setPlan({...plan, kpis: [...planKpis, {
      kpi_id: kpi.id, kpi_name: kpi.name, kpi_code: kpi.code, kpi_category: kpi.category,
      unit: kpi.unit, target_value: target, weight: customWeight, slab_set_id: null,
    }]});
    setAddKpiId('');
  };

  const updateKpi = (idx, field, value) => {
    const updated = [...planKpis];
    updated[idx] = {...updated[idx], [field]: value};
    setPlan({...plan, kpis: updated});
  };

  const removeKpi = (idx) => {
    setPlan({...plan, kpis: planKpis.filter((_, i) => i !== idx)});
  };

  // ===== HELPER: Apply a preset template =====
  const applyPreset = (presetKey) => {
    const preset = KPI_PRESETS[presetKey];
    if (!preset) return;

    const newKpis = [];
    let skipped = 0;
    for (const item of preset.kpis) {
      const kpi = allKpis.find(k => k.code === item.code);
      if (!kpi) { skipped++; continue; }
      newKpis.push({
        kpi_id: kpi.id, kpi_name: kpi.name, kpi_code: kpi.code, kpi_category: kpi.category,
        unit: kpi.unit, target_value: item.target, weight: item.weight, slab_set_id: null,
      });
    }
    setPlan({...plan, kpis: newKpis});
    toast.success(`Applied "${preset.label}" template — ${newKpis.length} KPIs${skipped ? ` (${skipped} skipped)` : ''}`);
    setHelperOpen(false);
  };

  // ===== HELPER: Auto-balance weights evenly =====
  const autoBalanceWeights = () => {
    if (planKpis.length === 0) return;
    const even = Math.floor(100 / planKpis.length);
    const remainder = 100 - (even * planKpis.length);
    const balanced = planKpis.map((k, i) => ({
      ...k,
      weight: i === 0 ? even + remainder : even,
    }));
    setPlan({...plan, kpis: balanced});
    toast.success(`Weights balanced: ${even}% each`);
  };

  // ===== HELPER: Clear all KPIs =====
  const clearAll = () => {
    if (planKpis.length === 0) return;
    if (!confirm('Remove all KPIs from this plan?')) return;
    setPlan({...plan, kpis: []});
  };

  const handleSave = async () => {
    if (!plan.id) return toast.error('Save the General tab first');
    if (totalWeight !== 100) {
      if (!confirm(`Total weight is ${totalWeight}%, not 100%. Save anyway?`)) return;
    }
    setSaving(true);
    try {
      await api.put(`/plans/${plan.id}/kpis`, {
        kpis: planKpis.map(k => ({ kpi_id: k.kpi_id, weight: k.weight, target_value: k.target_value, slab_set_id: k.slab_set_id })),
      });
      toast.success('KPIs saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const filteredKpis = categoryFilter === 'all'
    ? allKpis
    : (kpisByCategory[categoryFilter] || []);

  return (
    <div className="space-y-4">
      {/* ============ HEADER + VALIDATION ============ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900">KPI Configuration</h3>
          <p className="text-sm text-slate-500">Assign KPIs, set targets, and allocate weights (must sum to 100%)</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setHelperOpen(!helperOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 transition-colors"
          >
            <Wand2 className="w-4 h-4" />
            {helperOpen ? 'Hide Helper' : 'KPI Helper'}
          </button>
          <div className={cn(
            'px-3 py-1.5 text-sm font-semibold rounded-lg flex items-center gap-1.5',
            totalWeight === 100 ? 'bg-emerald-50 text-emerald-700'
              : totalWeight > 100 ? 'bg-rose-50 text-rose-700'
              : 'bg-amber-50 text-amber-700'
          )}>
            {totalWeight === 100 && <CheckCircle2 className="w-4 h-4" />}
            Total Weight: {totalWeight}%
          </div>
        </div>
      </div>

      {/* ============ KPI CONFIG HELPER ============ */}
      {helperOpen && (
        <div className="card p-5 bg-gradient-to-br from-violet-50/50 via-white to-sky-50/50 border-violet-100 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-semibold text-slate-900">Quick Setup Helper</h4>
              <p className="text-sm text-slate-600">
                Pick a role preset to auto-add recommended KPIs with suggested weights and targets,
                or browse the full KPI library by category.
              </p>
            </div>
          </div>

          {/* ---- Preset Templates ---- */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Step 1: Apply a Role Preset (optional)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {Object.entries(KPI_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => applyPreset(key)}
                  className="text-left p-3 rounded-lg border border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50/50 transition-colors group"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm text-slate-900 group-hover:text-violet-700">
                      {preset.label}
                    </span>
                    <span className="text-xs text-slate-400">{preset.kpis.length} KPIs</span>
                  </div>
                  <p className="text-xs text-slate-500 leading-snug">{preset.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* ---- Quick Actions ---- */}
          <div className="flex flex-wrap gap-2 pt-3 border-t border-violet-100">
            <button
              onClick={autoBalanceWeights}
              disabled={planKpis.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Scale className="w-4 h-4" /> Auto-Balance Weights
            </button>
            <button
              onClick={clearAll}
              disabled={planKpis.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-slate-200 text-rose-600 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Clear All
            </button>
          </div>

          {/* ---- Category Browser ---- */}
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Step 2: Browse KPIs by Category
            </div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={cn(
                    'px-3 py-1 text-xs font-medium rounded-full transition-colors',
                    categoryFilter === cat
                      ? 'bg-violet-600 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  )}
                >
                  {cat === 'all' ? `All (${allKpis.length})` : `${cat} (${kpisByCategory[cat].length})`}
                </button>
              ))}
            </div>
            <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg bg-white divide-y divide-slate-100">
              {filteredKpis.map(k => {
                const already = planKpis.some(pk => pk.kpi_id === k.id);
                return (
                  <div key={k.id} className="flex items-center justify-between px-3 py-2 hover:bg-slate-50">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-slate-900 truncate">{k.name}</div>
                      <div className="text-xs text-slate-500 truncate">
                        <span className="badge badge-gray text-[10px] mr-1">{k.category}</span>
                        {k.code} · {k.unit}
                      </div>
                    </div>
                    <button
                      onClick={() => !already && addKpi(k.id)}
                      disabled={already}
                      className={cn(
                        'px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex-shrink-0 ml-2',
                        already
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
                      )}
                    >
                      {already ? '✓ Added' : '+ Add'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ============ WEIGHT WARNING ============ */}
      {planKpis.length > 0 && totalWeight !== 100 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm">
          <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-amber-800">
            Weights total <strong>{totalWeight}%</strong> — must equal <strong>100%</strong> before calculation.
            {' '}
            <button onClick={autoBalanceWeights} className="underline font-medium hover:no-underline">
              Auto-balance now
            </button>
          </div>
        </div>
      )}

      {/* ============ KPI TABLE ============ */}
      <div className="overflow-x-auto card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left py-3 px-4 font-medium text-slate-600">KPI</th>
              <th className="text-left py-3 px-4 font-medium text-slate-600 hidden md:table-cell">Category</th>
              <th className="text-right py-3 px-4 font-medium text-slate-600">Target</th>
              <th className="text-right py-3 px-4 font-medium text-slate-600">Weight %</th>
              <th className="text-center py-3 px-4 font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {planKpis.map((pk, i) => (
              <tr key={pk.kpi_id || i} className="border-b border-slate-100">
                <td className="py-3 px-4">
                  <div className="font-medium text-slate-900">{pk.kpi_name}</div>
                  <div className="text-xs text-slate-400">
                    {pk.kpi_code} · {pk.unit}
                    <span className="md:hidden ml-2 badge badge-gray text-[10px]">{pk.kpi_category}</span>
                  </div>
                </td>
                <td className="py-3 px-4 hidden md:table-cell">
                  <span className="badge badge-gray">{pk.kpi_category}</span>
                </td>
                <td className="py-2 px-4 text-right">
                  <input type="number" className="input w-28 text-right" value={pk.target_value}
                    onChange={e => updateKpi(i, 'target_value', Number(e.target.value))} />
                </td>
                <td className="py-2 px-4 text-right">
                  <input type="number" className="input w-20 text-right" value={pk.weight}
                    onChange={e => updateKpi(i, 'weight', Number(e.target.value))} />
                </td>
                <td className="py-3 px-4 text-center">
                  <button onClick={() => removeKpi(i)} className="p-1 hover:bg-rose-50 rounded">
                    <Trash2 className="w-4 h-4 text-rose-400" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {planKpis.length === 0 && (
        <div className="text-center py-8 text-slate-500">
          <Target className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          <p className="mb-2">No KPIs configured for this plan</p>
          <button onClick={() => setHelperOpen(true)} className="text-sm text-violet-600 hover:text-violet-700 font-medium">
            <Wand2 className="w-4 h-4 inline mr-1" /> Open KPI Helper to get started
          </button>
        </div>
      )}

      <div className="pt-4 border-t border-slate-200 flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save KPIs'}
        </button>
        {totalWeight === 100 && (
          <span className="text-sm text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" /> Ready to save
          </span>
        )}
      </div>
    </div>
  );
}

function SlabsTab({ plan, setPlan, allKpis }) {
  const [saving, setSaving] = useState(false);
  const slabSets = plan.slab_sets || [];

  const addSlabSet = () => {
    setPlan({...plan, slab_sets: [...slabSets, { name: '', type: 'step', kpi_id: '', tiers: [] }]});
  };

  const updateSet = (idx, field, value) => {
    const updated = [...slabSets];
    updated[idx] = {...updated[idx], [field]: value};
    setPlan({...plan, slab_sets: updated});
  };

  const removeSet = (idx) => {
    setPlan({...plan, slab_sets: slabSets.filter((_, i) => i !== idx)});
  };

  const addTier = (setIdx) => {
    const updated = [...slabSets];
    const tiers = [...(updated[setIdx].tiers || [])];
    tiers.push({ tier_order: tiers.length + 1, min_percent: 0, max_percent: 100, rate: 0, rate_type: 'percentage' });
    updated[setIdx] = {...updated[setIdx], tiers};
    setPlan({...plan, slab_sets: updated});
  };

  const updateTier = (setIdx, tierIdx, field, value) => {
    const updated = [...slabSets];
    const tiers = [...updated[setIdx].tiers];
    tiers[tierIdx] = {...tiers[tierIdx], [field]: value};
    updated[setIdx] = {...updated[setIdx], tiers};
    setPlan({...plan, slab_sets: updated});
  };

  const removeTier = (setIdx, tierIdx) => {
    const updated = [...slabSets];
    updated[setIdx] = {...updated[setIdx], tiers: updated[setIdx].tiers.filter((_, i) => i !== tierIdx)};
    setPlan({...plan, slab_sets: updated});
  };

  const handleSave = async () => {
    if (!plan.id) return toast.error('Save the General tab first');
    setSaving(true);
    try {
      await api.put(`/plans/${plan.id}/slabs`, { slab_sets: slabSets });
      toast.success('Slabs saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-900">Slab Configuration</h3>
          <p className="text-sm text-slate-500">Define payout rates at different achievement levels</p>
        </div>
        <button onClick={addSlabSet} className="btn-primary flex items-center gap-1 text-sm">
          <Plus className="w-4 h-4" /> Add Slab Set
        </button>
      </div>

      {slabSets.map((slab, si) => (
        <div key={slab.id || si} className="border border-slate-200 rounded-lg p-4 space-y-4">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <label className="label">Name</label>
              <input className="input" value={slab.name} onChange={e => updateSet(si, 'name', e.target.value)} placeholder="e.g., Revenue Slab" />
            </div>
            <div className="w-40">
              <label className="label">Type</label>
              <select className="input" value={slab.type} onChange={e => updateSet(si, 'type', e.target.value)}>
                <option value="step">Step</option>
                <option value="progressive">Progressive</option>
                <option value="accelerator">Accelerator</option>
              </select>
            </div>
            <div className="w-48">
              <label className="label">KPI</label>
              <select className="input" value={slab.kpi_id || ''} onChange={e => updateSet(si, 'kpi_id', e.target.value)}>
                <option value="">Select...</option>
                {allKpis.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            </div>
            <button onClick={() => removeSet(si)} className="mt-7 p-1 hover:bg-rose-50 rounded">
              <Trash2 className="w-4 h-4 text-rose-400" />
            </button>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 px-3 font-medium text-slate-600">Tier</th>
                <th className="text-left py-2 px-3 font-medium text-slate-600">Min %</th>
                <th className="text-left py-2 px-3 font-medium text-slate-600">Max %</th>
                <th className="text-left py-2 px-3 font-medium text-slate-600">Rate</th>
                <th className="text-left py-2 px-3 font-medium text-slate-600">Rate Type</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {(slab.tiers || []).map((tier, ti) => (
                <tr key={tier.id || ti} className="border-b border-slate-100">
                  <td className="py-2 px-3 text-slate-600">{ti + 1}</td>
                  <td className="py-1 px-3"><input type="number" className="input w-20" value={tier.min_percent} onChange={e => updateTier(si, ti, 'min_percent', Number(e.target.value))} /></td>
                  <td className="py-1 px-3"><input type="number" className="input w-20" value={tier.max_percent ?? ''} onChange={e => updateTier(si, ti, 'max_percent', e.target.value === '' ? null : Number(e.target.value))} /></td>
                  <td className="py-1 px-3"><input type="number" className="input w-20" value={tier.rate} onChange={e => updateTier(si, ti, 'rate', Number(e.target.value))} /></td>
                  <td className="py-1 px-3">
                    <select className="input w-28" value={tier.rate_type} onChange={e => updateTier(si, ti, 'rate_type', e.target.value)}>
                      <option value="percentage">Percentage</option>
                      <option value="fixed">Fixed</option>
                      <option value="per_unit">Per Unit</option>
                    </select>
                  </td>
                  <td className="py-1 px-1"><button onClick={() => removeTier(si, ti)} className="p-1 hover:bg-rose-50 rounded"><Trash2 className="w-3.5 h-3.5 text-rose-400" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => addTier(si)} className="text-sm text-primary-600 hover:underline flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Add Tier</button>
        </div>
      ))}

      {slabSets.length === 0 && (
        <div className="text-center py-8 text-slate-500">
          <BarChart3 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          <p>No slab configurations</p>
        </div>
      )}

      <div className="pt-4 border-t border-slate-200">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Slabs'}
        </button>
      </div>
    </div>
  );
}

function ScopePicker({ title, scopeType, options, loading, selected, onToggle, searchable, searchPlaceholder, onSearch, searchLoading }) {
  const [search, setSearch] = useState('');

  // For async search (onSearch provided), debounce API calls
  useEffect(() => {
    if (!onSearch || !search || search.length < 2) return;
    const timer = setTimeout(() => onSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search, onSearch]);

  const filtered = searchable && search && !onSearch
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const isLoading = loading || searchLoading;

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-700">{title}</span>
        <span className="text-xs text-slate-400">{selected.length} selected</span>
      </div>
      {searchable && (
        <input
          className="input text-sm mb-2"
          placeholder={searchPlaceholder || 'Search...'}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      )}
      {isLoading ? (
        <div className="text-xs text-slate-400 py-2">Loading...</div>
      ) : (
        <div className={cn("space-y-1 overflow-y-auto", filtered.length > 8 ? "max-h-48" : "")}>
          {filtered.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-slate-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => onToggle(opt.value)}
                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-slate-700 truncate">{opt.label}</span>
            </label>
          ))}
          {filtered.length === 0 && !isLoading && (
            <div className="text-xs text-slate-400 py-2">
              {onSearch && search.length < 2 ? 'Type at least 2 characters to search...' : 'No matches'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RulesTab({ plan, setPlan }) {
  const [saving, setSaving] = useState(false);
  const [productCategories, setProductCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [customerChannels, setCustomerChannels] = useState([]);
  const [customerGroups, setCustomerGroups] = useState([]);
  const [customerSearchResults, setCustomerSearchResults] = useState([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [loadingLookups, setLoadingLookups] = useState(true);

  // Load lookup values — customer lookups are filtered by plan territories
  useEffect(() => {
    const territoryIds = (plan.territories || []).map(t => t.id).join(',');
    const tParam = territoryIds ? `&territories=${territoryIds}` : '';
    setLoadingLookups(true);
    Promise.all([
      api.get('/lookups/filter-values?field=product_category'),
      api.get('/lookups/filter-values?field=product_sku'),
      api.get(`/lookups/filter-values?field=customer_channel${tParam}`),
      api.get(`/lookups/filter-values?field=customer_group${tParam}`),
    ]).then(([cats, prods, channels, groups]) => {
      setProductCategories(cats);
      setProducts(prods);
      setCustomerChannels(channels);
      setCustomerGroups(groups);
    }).catch(() => toast.error('Failed to load lookup data'))
      .finally(() => setLoadingLookups(false));
  }, [plan.territories]);

  // Parse existing rules into scope state
  const ruleSets = plan.rule_sets || [];
  const allRules = ruleSets.flatMap(rs => (rs.rules || []).map(r => ({
    ...r,
    match_values: typeof r.match_values === 'string' ? JSON.parse(r.match_values) : (r.match_values || []),
  })));

  // Extract current scope from rules
  const getIncludeValues = (dim) => {
    const rule = allRules.find(r => r.dimension === dim && r.rule_type === 'include');
    return rule ? rule.match_values : [];
  };
  const getExcludeValues = (dim) => {
    const rule = allRules.find(r => r.dimension === dim && r.rule_type === 'exclude');
    return rule ? rule.match_values : [];
  };

  // Determine active scope modes from existing rules
  const hasInclude = (dim) => allRules.some(r => r.dimension === dim && r.rule_type === 'include');

  const [productMode, setProductMode] = useState(
    hasInclude('product') ? 'products' : hasInclude('product_category') ? 'categories' : 'all'
  );
  const [customerMode, setCustomerMode] = useState(
    hasInclude('customer') ? 'customers' :
    hasInclude('customer_group') ? 'groups' :
    hasInclude('customer_channel') ? 'channels' : 'all'
  );

  const [selectedProductCats, setSelectedProductCats] = useState(getIncludeValues('product_category'));
  const [selectedProducts, setSelectedProducts] = useState(getIncludeValues('product'));
  const [excludedProductCats, setExcludedProductCats] = useState(getExcludeValues('product_category'));
  const [excludedProducts, setExcludedProducts] = useState(getExcludeValues('product'));

  const [selectedChannels, setSelectedChannels] = useState(getIncludeValues('customer_channel'));
  const [selectedGroups, setSelectedGroups] = useState(getIncludeValues('customer_group'));
  const [selectedCustomers, setSelectedCustomers] = useState(getIncludeValues('customer'));
  const [excludedChannels, setExcludedChannels] = useState(getExcludeValues('customer_channel'));
  const [excludedGroups, setExcludedGroups] = useState(getExcludeValues('customer_group'));
  const [excludedCustomers, setExcludedCustomers] = useState(getExcludeValues('customer'));

  const [showProductExclude, setShowProductExclude] = useState(
    getExcludeValues('product_category').length > 0 || getExcludeValues('product').length > 0
  );
  const [showCustomerExclude, setShowCustomerExclude] = useState(
    getExcludeValues('customer_channel').length > 0 || getExcludeValues('customer_group').length > 0 || getExcludeValues('customer').length > 0
  );

  const toggle = (arr, setArr, val) => {
    setArr(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]);
  };

  // Async customer search handler
  const handleCustomerSearch = useCallback((searchTerm) => {
    const territoryIds = (plan.territories || []).map(t => t.id).join(',');
    const tParam = territoryIds ? `&territories=${territoryIds}` : '';
    setCustomerSearchLoading(true);
    api.get(`/lookups/customers?search=${encodeURIComponent(searchTerm)}${tParam}`)
      .then(customers => {
        setCustomerSearchResults(customers.map(c => ({
          value: c.id,
          label: `${c.name} (${c.channel || ''} - ${c.customer_group || ''})`,
        })));
      })
      .catch(() => toast.error('Failed to search customers'))
      .finally(() => setCustomerSearchLoading(false));
  }, [plan.territories]);

  // Build rules from UI state
  const buildRules = () => {
    const rules = [];
    // Product includes
    if (productMode === 'categories' && selectedProductCats.length > 0) {
      rules.push({ dimension: 'product_category', rule_type: 'include', match_type: 'exact', match_values: selectedProductCats });
    }
    if (productMode === 'products' && selectedProducts.length > 0) {
      rules.push({ dimension: 'product', rule_type: 'include', match_type: 'exact', match_values: selectedProducts });
    }
    // Product excludes
    if (excludedProductCats.length > 0) {
      rules.push({ dimension: 'product_category', rule_type: 'exclude', match_type: 'exact', match_values: excludedProductCats });
    }
    if (excludedProducts.length > 0) {
      rules.push({ dimension: 'product', rule_type: 'exclude', match_type: 'exact', match_values: excludedProducts });
    }
    // Customer includes
    if (customerMode === 'channels' && selectedChannels.length > 0) {
      rules.push({ dimension: 'customer_channel', rule_type: 'include', match_type: 'exact', match_values: selectedChannels });
    }
    if (customerMode === 'groups' && selectedGroups.length > 0) {
      rules.push({ dimension: 'customer_group', rule_type: 'include', match_type: 'exact', match_values: selectedGroups });
    }
    if (customerMode === 'customers' && selectedCustomers.length > 0) {
      rules.push({ dimension: 'customer', rule_type: 'include', match_type: 'exact', match_values: selectedCustomers });
    }
    // Customer excludes
    if (excludedChannels.length > 0) {
      rules.push({ dimension: 'customer_channel', rule_type: 'exclude', match_type: 'exact', match_values: excludedChannels });
    }
    if (excludedGroups.length > 0) {
      rules.push({ dimension: 'customer_group', rule_type: 'exclude', match_type: 'exact', match_values: excludedGroups });
    }
    if (excludedCustomers.length > 0) {
      rules.push({ dimension: 'customer', rule_type: 'exclude', match_type: 'exact', match_values: excludedCustomers });
    }
    return rules;
  };

  const handleSave = async () => {
    if (!plan.id) return toast.error('Save the General tab first');
    setSaving(true);
    try {
      const rules = buildRules();
      const payload = rules.length > 0
        ? [{ name: 'Scope Rules', description: 'Product & Customer scope', rules }]
        : [];
      await api.put(`/plans/${plan.id}/rules`, { rule_sets: payload });
      // Update local plan state
      setPlan({ ...plan, rule_sets: payload.map(rs => ({ ...rs, rules: rs.rules })) });
      toast.success('Scope saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Summary text
  const productSummary = productMode === 'all' ? 'All products'
    : productMode === 'categories' ? `${selectedProductCats.length} categories selected`
    : `${selectedProducts.length} products selected`;
  const customerSummary = customerMode === 'all' ? 'All customers'
    : customerMode === 'channels' ? `${selectedChannels.length} channels selected`
    : customerMode === 'groups' ? `${selectedGroups.length} groups selected`
    : `${selectedCustomers.length} customers selected`;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold text-slate-900">Product & Customer Scope</h3>
        <p className="text-sm text-slate-500">Define which products and customers this commission plan applies to</p>
      </div>

      {/* Summary badges */}
      <div className="flex gap-3">
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 text-sm text-blue-800">
          Products: {productSummary}
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 text-sm text-emerald-800">
          Customers: {customerSummary}
        </div>
      </div>

      {/* Product Scope */}
      <div className="card p-5 space-y-4">
        <h4 className="font-medium text-slate-800 flex items-center gap-2">
          <span className="w-2 h-2 bg-blue-500 rounded-full" /> Product Scope
        </h4>

        <div className="flex gap-3">
          {['all', 'categories', 'products'].map(mode => (
            <label key={mode} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio" name="productMode" value={mode}
                checked={productMode === mode}
                onChange={() => setProductMode(mode)}
                className="text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-slate-700">
                {mode === 'all' ? 'All Products' : mode === 'categories' ? 'By Category' : 'Specific Products'}
              </span>
            </label>
          ))}
        </div>

        {productMode === 'categories' && (
          <ScopePicker
            title="Select Product Categories"
            options={productCategories}
            loading={loadingLookups}
            selected={selectedProductCats}
            onToggle={val => toggle(selectedProductCats, setSelectedProductCats, val)}
          />
        )}

        {productMode === 'products' && (
          <ScopePicker
            title="Select Specific Products"
            options={products}
            loading={loadingLookups}
            selected={selectedProducts}
            onToggle={val => toggle(selectedProducts, setSelectedProducts, val)}
            searchable
            searchPlaceholder="Search by name or SKU..."
          />
        )}

        {/* Product exclusions */}
        {productMode !== 'all' && (
          <div>
            {!showProductExclude ? (
              <button onClick={() => setShowProductExclude(true)} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add product exclusions
              </button>
            ) : (
              <div className="border-t border-slate-100 pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-rose-600 uppercase">Exclude</span>
                  <button onClick={() => { setShowProductExclude(false); setExcludedProductCats([]); setExcludedProducts([]); }}
                    className="text-xs text-slate-400 hover:text-slate-600">Clear exclusions</button>
                </div>
                <ScopePicker
                  title="Exclude Categories"
                  options={productCategories.filter(c => !selectedProductCats.includes(c.value))}
                  loading={loadingLookups}
                  selected={excludedProductCats}
                  onToggle={val => toggle(excludedProductCats, setExcludedProductCats, val)}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Customer Scope */}
      <div className="card p-5 space-y-4">
        <h4 className="font-medium text-slate-800 flex items-center gap-2">
          <span className="w-2 h-2 bg-emerald-500 rounded-full" /> Customer Scope
        </h4>

        <div className="flex flex-wrap gap-3">
          {['all', 'channels', 'groups', 'customers'].map(mode => (
            <label key={mode} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio" name="customerMode" value={mode}
                checked={customerMode === mode}
                onChange={() => setCustomerMode(mode)}
                className="text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-slate-700">
                {mode === 'all' ? 'All Customers' : mode === 'channels' ? 'By Channel' : mode === 'groups' ? 'By Customer Group' : 'Specific Customers'}
              </span>
            </label>
          ))}
        </div>

        {customerMode === 'channels' && (
          <ScopePicker
            title="Select Customer Channels"
            options={customerChannels}
            loading={loadingLookups}
            selected={selectedChannels}
            onToggle={val => toggle(selectedChannels, setSelectedChannels, val)}
          />
        )}

        {customerMode === 'groups' && (
          <ScopePicker
            title="Select Customer Groups"
            options={customerGroups}
            loading={loadingLookups}
            selected={selectedGroups}
            onToggle={val => toggle(selectedGroups, setSelectedGroups, val)}
          />
        )}

        {customerMode === 'customers' && (
          <ScopePicker
            title="Select Specific Customers"
            options={customerSearchResults}
            loading={false}
            searchLoading={customerSearchLoading}
            selected={selectedCustomers}
            onToggle={val => toggle(selectedCustomers, setSelectedCustomers, val)}
            searchable
            searchPlaceholder="Search customers by name..."
            onSearch={handleCustomerSearch}
          />
        )}

        {/* Customer exclusions */}
        {customerMode !== 'all' && (
          <div>
            {!showCustomerExclude ? (
              <button onClick={() => setShowCustomerExclude(true)} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add customer exclusions
              </button>
            ) : (
              <div className="border-t border-slate-100 pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-rose-600 uppercase">Exclude</span>
                  <button onClick={() => { setShowCustomerExclude(false); setExcludedChannels([]); setExcludedGroups([]); setExcludedCustomers([]); }}
                    className="text-xs text-slate-400 hover:text-slate-600">Clear exclusions</button>
                </div>
                {customerMode === 'channels' && (
                  <ScopePicker
                    title="Exclude Channels"
                    options={customerChannels.filter(c => !selectedChannels.includes(c.value))}
                    loading={loadingLookups}
                    selected={excludedChannels}
                    onToggle={val => toggle(excludedChannels, setExcludedChannels, val)}
                  />
                )}
                {customerMode === 'groups' && (
                  <ScopePicker
                    title="Exclude Groups"
                    options={customerGroups.filter(g => !selectedGroups.includes(g.value))}
                    loading={loadingLookups}
                    selected={excludedGroups}
                    onToggle={val => toggle(excludedGroups, setExcludedGroups, val)}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-slate-200">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Scope'}
        </button>
      </div>
    </div>
  );
}

function EligibilityTab({ plan, setPlan }) {
  const [saving, setSaving] = useState(false);
  const rules = plan.eligibility_rules || [];

  const addRule = () => {
    setPlan({...plan, eligibility_rules: [...rules, {
      metric: 'min_sales', operator: '>=', threshold: 0, action: 'zero_payout', reduction_percent: 0, is_active: 1,
    }]});
  };

  const updateRule = (idx, field, value) => {
    const updated = [...rules];
    updated[idx] = {...updated[idx], [field]: value};
    setPlan({...plan, eligibility_rules: updated});
  };

  const removeRule = (idx) => {
    setPlan({...plan, eligibility_rules: rules.filter((_, i) => i !== idx)});
  };

  const handleSave = async () => {
    if (!plan.id) return toast.error('Save the General tab first');
    setSaving(true);
    try {
      await api.put(`/plans/${plan.id}/eligibility`, {
        rules: rules.map(r => ({ metric: r.metric, operator: r.operator, threshold: Number(r.threshold) || 0, action: r.action, reduction_percent: Number(r.reduction_percent) || 0 })),
      });
      toast.success('Eligibility rules saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-900">Eligibility Rules</h3>
          <p className="text-sm text-slate-500">Minimum criteria employees must meet to receive payouts</p>
        </div>
        <button onClick={addRule} className="btn-primary flex items-center gap-1 text-sm">
          <Plus className="w-4 h-4" /> Add Rule
        </button>
      </div>

      <div className="space-y-3">
        {rules.map((rule, i) => (
          <div key={rule.id || i} className="flex items-center gap-3 py-3 px-4 border border-slate-200 rounded-lg">
            <select className="input w-44" value={rule.metric} onChange={e => updateRule(i, 'metric', e.target.value)}>
              <option value="min_sales">Min Sales</option>
              <option value="min_collection_percent">Min Collection %</option>
              <option value="max_return_percent">Max Return %</option>
              <option value="min_active_days">Min Active Days</option>
              <option value="min_lines_sold">Min Lines Sold</option>
            </select>
            <select className="input w-20" value={rule.operator} onChange={e => updateRule(i, 'operator', e.target.value)}>
              <option value=">=">{'>='}</option>
              <option value="<=">{'<='}</option>
              <option value=">">{'>'}</option>
              <option value="<">{'<'}</option>
              <option value="=">{'='}</option>
            </select>
            <input type="number" className="input w-24" value={rule.threshold ?? ''} onChange={e => updateRule(i, 'threshold', e.target.value === '' ? '' : Number(e.target.value))} />
            <select className="input w-36" value={rule.action} onChange={e => updateRule(i, 'action', e.target.value)}>
              <option value="zero_payout">Zero Payout</option>
              <option value="reduce_percent">Reduce %</option>
              <option value="warning_only">Warning Only</option>
            </select>
            {rule.action === 'reduce_percent' && (
              <input type="number" className="input w-20" value={rule.reduction_percent} onChange={e => updateRule(i, 'reduction_percent', Number(e.target.value))} placeholder="%" />
            )}
            <button onClick={() => removeRule(i)} className="p-1 hover:bg-rose-50 rounded ml-auto">
              <Trash2 className="w-4 h-4 text-rose-400" />
            </button>
          </div>
        ))}
      </div>

      {rules.length === 0 && (
        <div className="text-center py-8 text-slate-500">
          <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          <p>No eligibility rules configured</p>
        </div>
      )}

      <div className="pt-4 border-t border-slate-200">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Eligibility'}
        </button>
      </div>
    </div>
  );
}

function MultipliersTab({ plan, setPlan }) {
  const [saving, setSaving] = useState(false);
  const rules = plan.multiplier_rules || [];

  const addRule = () => {
    setPlan({...plan, multiplier_rules: [...rules, {
      name: '', type: 'growth', condition_metric: 'revenue_growth_percent',
      condition_operator: '>=', condition_value: 0, multiplier_value: 1.0,
      stacking_mode: 'multiplicative', is_active: 1,
    }]});
  };

  const updateRule = (idx, field, value) => {
    const updated = [...rules];
    updated[idx] = {...updated[idx], [field]: value};
    setPlan({...plan, multiplier_rules: updated});
  };

  const removeRule = (idx) => {
    setPlan({...plan, multiplier_rules: rules.filter((_, i) => i !== idx)});
  };

  const handleSave = async () => {
    if (!plan.id) return toast.error('Save the General tab first');
    setSaving(true);
    try {
      await api.put(`/plans/${plan.id}/multipliers`, {
        rules: rules.map(r => ({
          name: r.name, type: r.type, condition_metric: r.condition_metric,
          condition_operator: r.condition_operator, condition_value: Number(r.condition_value) || 0,
          multiplier_value: Number(r.multiplier_value) || 1, stacking_mode: r.stacking_mode,
        })),
      });
      toast.success('Multipliers saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-900">Multiplier Rules</h3>
          <p className="text-sm text-slate-500">Bonus multipliers for exceeding specific conditions</p>
        </div>
        <button onClick={addRule} className="btn-primary flex items-center gap-1 text-sm">
          <Plus className="w-4 h-4" /> Add Multiplier
        </button>
      </div>

      <div className="space-y-3">
        {rules.map((rule, i) => (
          <div key={rule.id || i} className="border border-slate-200 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <label className="label">Name</label>
                <input className="input" value={rule.name} onChange={e => updateRule(i, 'name', e.target.value)} placeholder="e.g., Growth Bonus" />
              </div>
              <div className="w-36">
                <label className="label">Type</label>
                <select className="input" value={rule.type} onChange={e => updateRule(i, 'type', e.target.value)}>
                  <option value="growth">Growth</option>
                  <option value="strategic_sku">Strategic SKU</option>
                  <option value="new_launch">New Launch</option>
                  <option value="channel_mix">Channel Mix</option>
                  <option value="collection_speed">Collection Speed</option>
                </select>
              </div>
              <button onClick={() => removeRule(i)} className="mt-7 p-1 hover:bg-rose-50 rounded">
                <Trash2 className="w-4 h-4 text-rose-400" />
              </button>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="label">Condition Metric</label>
                <input className="input" value={rule.condition_metric} onChange={e => updateRule(i, 'condition_metric', e.target.value)} />
              </div>
              <div className="w-20">
                <label className="label">Op</label>
                <select className="input" value={rule.condition_operator} onChange={e => updateRule(i, 'condition_operator', e.target.value)}>
                  <option value=">=">{'>='}</option>
                  <option value="<=">{'<='}</option>
                  <option value=">">{'>'}</option>
                  <option value="<">{'<'}</option>
                  <option value="=">{'='}</option>
                </select>
              </div>
              <div className="w-24">
                <label className="label">Value</label>
                <input type="number" className="input" value={rule.condition_value ?? ''} onChange={e => updateRule(i, 'condition_value', e.target.value === '' ? '' : Number(e.target.value))} />
              </div>
              <div className="w-24">
                <label className="label">Multiplier</label>
                <input type="number" step="0.1" className="input" value={rule.multiplier_value ?? ''} onChange={e => updateRule(i, 'multiplier_value', e.target.value === '' ? '' : Number(e.target.value))} />
              </div>
              <div className="w-36">
                <label className="label">Stacking</label>
                <select className="input" value={rule.stacking_mode} onChange={e => updateRule(i, 'stacking_mode', e.target.value)}>
                  <option value="multiplicative">Multiplicative</option>
                  <option value="additive">Additive</option>
                  <option value="highest_only">Highest Only</option>
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>

      {rules.length === 0 && (
        <div className="text-center py-8 text-slate-500">
          <Zap className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          <p>No multiplier rules configured</p>
        </div>
      )}

      <div className="pt-4 border-t border-slate-200">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Multipliers'}
        </button>
      </div>
    </div>
  );
}

function PenaltiesTab({ plan, setPlan }) {
  const [saving, setSaving] = useState(false);
  const rules = plan.penalty_rules || [];

  const addRule = () => {
    setPlan({...plan, penalty_rules: [...rules, {
      name: '', trigger_metric: 'return_percent', trigger_operator: '>',
      trigger_value: 0, penalty_type: 'percentage', penalty_value: 0, is_active: 1,
    }]});
  };

  const updateRule = (idx, field, value) => {
    const updated = [...rules];
    updated[idx] = {...updated[idx], [field]: value};
    setPlan({...plan, penalty_rules: updated});
  };

  const removeRule = (idx) => {
    setPlan({...plan, penalty_rules: rules.filter((_, i) => i !== idx)});
  };

  const handleSave = async () => {
    if (!plan.id) return toast.error('Save the General tab first');
    setSaving(true);
    try {
      await api.put(`/plans/${plan.id}/penalties`, {
        rules: rules.map(r => ({
          name: r.name, trigger_metric: r.trigger_metric, trigger_operator: r.trigger_operator,
          trigger_value: Number(r.trigger_value) || 0, penalty_type: r.penalty_type, penalty_value: Number(r.penalty_value) || 0,
        })),
      });
      toast.success('Penalties saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-900">Penalty Rules</h3>
          <p className="text-sm text-slate-500">Deductions triggered when thresholds are exceeded</p>
        </div>
        <button onClick={addRule} className="btn-primary flex items-center gap-1 text-sm">
          <Plus className="w-4 h-4" /> Add Penalty
        </button>
      </div>

      <div className="space-y-3">
        {rules.map((rule, i) => (
          <div key={rule.id || i} className="flex items-center gap-3 py-3 px-4 border border-slate-200 rounded-lg">
            <div className="flex-1">
              <input className="input" value={rule.name} onChange={e => updateRule(i, 'name', e.target.value)} placeholder="Penalty name" />
            </div>
            <input className="input w-36" value={rule.trigger_metric} onChange={e => updateRule(i, 'trigger_metric', e.target.value)} placeholder="Metric" />
            <select className="input w-20" value={rule.trigger_operator} onChange={e => updateRule(i, 'trigger_operator', e.target.value)}>
              <option value=">=">{'>='}</option>
              <option value="<=">{'<='}</option>
              <option value=">">{'>'}</option>
              <option value="<">{'<'}</option>
              <option value="=">{'='}</option>
            </select>
            <input type="number" className="input w-24" value={rule.trigger_value ?? ''} onChange={e => updateRule(i, 'trigger_value', e.target.value === '' ? '' : Number(e.target.value))} />
            <select className="input w-28" value={rule.penalty_type} onChange={e => updateRule(i, 'penalty_type', e.target.value)}>
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed</option>
              <option value="slab_downgrade">Slab Downgrade</option>
            </select>
            <input type="number" className="input w-20" value={rule.penalty_value ?? ''} onChange={e => updateRule(i, 'penalty_value', e.target.value === '' ? '' : Number(e.target.value))} />
            <button onClick={() => removeRule(i)} className="p-1 hover:bg-rose-50 rounded">
              <Trash2 className="w-4 h-4 text-rose-400" />
            </button>
          </div>
        ))}
      </div>

      {rules.length === 0 && (
        <div className="text-center py-8 text-slate-500">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          <p>No penalty rules configured</p>
        </div>
      )}

      <div className="pt-4 border-t border-slate-200">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Penalties'}
        </button>
      </div>
    </div>
  );
}

function CapsTab({ plan, setPlan, allRoles }) {
  const [saving, setSaving] = useState(false);
  const caps = plan.capping_rules || [];
  const splits = plan.split_rules || [];

  const addCap = () => {
    setPlan({...plan, capping_rules: [...caps, { cap_type: 'max_per_plan', cap_value: 0, is_active: 1 }]});
  };

  const updateCap = (idx, field, value) => {
    const updated = [...caps];
    updated[idx] = {...updated[idx], [field]: value};
    setPlan({...plan, capping_rules: updated});
  };

  const removeCap = (idx) => {
    setPlan({...plan, capping_rules: caps.filter((_, i) => i !== idx)});
  };

  const addSplit = () => {
    setPlan({...plan, split_rules: [...splits, { name: '', participants: [] }]});
  };

  const updateSplit = (idx, field, value) => {
    const updated = [...splits];
    updated[idx] = {...updated[idx], [field]: value};
    setPlan({...plan, split_rules: updated});
  };

  const removeSplit = (idx) => {
    setPlan({...plan, split_rules: splits.filter((_, i) => i !== idx)});
  };

  const addParticipant = (splitIdx) => {
    const updated = [...splits];
    const participants = [...(updated[splitIdx].participants || [])];
    participants.push({ role_id: '', split_percent: 0 });
    updated[splitIdx] = {...updated[splitIdx], participants};
    setPlan({...plan, split_rules: updated});
  };

  const updateParticipant = (splitIdx, partIdx, field, value) => {
    const updated = [...splits];
    const participants = [...updated[splitIdx].participants];
    participants[partIdx] = {...participants[partIdx], [field]: value};
    updated[splitIdx] = {...updated[splitIdx], participants};
    setPlan({...plan, split_rules: updated});
  };

  const removeParticipant = (splitIdx, partIdx) => {
    const updated = [...splits];
    updated[splitIdx] = {...updated[splitIdx], participants: updated[splitIdx].participants.filter((_, i) => i !== partIdx)};
    setPlan({...plan, split_rules: updated});
  };

  const handleSave = async () => {
    if (!plan.id) return toast.error('Save the General tab first');
    setSaving(true);
    try {
      await Promise.all([
        api.put(`/plans/${plan.id}/caps`, {
          rules: caps.map(c => ({ cap_type: c.cap_type, cap_value: c.cap_value })),
        }),
        api.put(`/plans/${plan.id}/splits`, {
          rules: splits.map(s => ({
            name: s.name, trigger_condition: s.trigger_condition,
            participants: (s.participants || []).map(p => ({ role_id: p.role_id, split_percent: p.split_percent })),
          })),
        }),
      ]);
      toast.success('Caps & Splits saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Caps */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">Capping Rules</h3>
            <p className="text-sm text-slate-500">Maximum payout limits (most restrictive wins)</p>
          </div>
          <button onClick={addCap} className="btn-primary flex items-center gap-1 text-sm">
            <Plus className="w-4 h-4" /> Add Cap
          </button>
        </div>

        <div className="space-y-3">
          {caps.map((cap, i) => (
            <div key={cap.id || i} className="flex items-center gap-4 py-3 px-4 border border-slate-200 rounded-lg">
              <select className="input w-44" value={cap.cap_type} onChange={e => updateCap(i, 'cap_type', e.target.value)}>
                <option value="max_per_plan">Max Per Plan</option>
                <option value="percent_of_salary">% of Salary</option>
                <option value="max_per_kpi">Max Per KPI</option>
              </select>
              <input type="number" className="input w-32" value={cap.cap_value ?? ''} onChange={e => updateCap(i, 'cap_value', e.target.value === '' ? '' : Number(e.target.value))} />
              <button onClick={() => removeCap(i)} className="p-1 hover:bg-rose-50 rounded ml-auto">
                <Trash2 className="w-4 h-4 text-rose-400" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Splits */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">Split Rules</h3>
            <p className="text-sm text-slate-500">Commission split between roles</p>
          </div>
          <button onClick={addSplit} className="btn-primary flex items-center gap-1 text-sm">
            <Plus className="w-4 h-4" /> Add Split
          </button>
        </div>

        <div className="space-y-3">
          {splits.map((split, si) => (
            <div key={split.id || si} className="border border-slate-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="label">Split Name</label>
                  <input className="input" value={split.name} onChange={e => updateSplit(si, 'name', e.target.value)} placeholder="e.g., SR-SS Split" />
                </div>
                <button onClick={() => removeSplit(si)} className="mt-7 p-1 hover:bg-rose-50 rounded">
                  <Trash2 className="w-4 h-4 text-rose-400" />
                </button>
              </div>
              <div className="space-y-2">
                {(split.participants || []).map((p, pi) => (
                  <div key={p.id || pi} className="flex items-center gap-3">
                    <select className="input w-48" value={p.role_id} onChange={e => updateParticipant(si, pi, 'role_id', e.target.value)}>
                      <option value="">Select role...</option>
                      {allRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <input type="number" className="input w-24" value={p.split_percent} onChange={e => updateParticipant(si, pi, 'split_percent', Number(e.target.value))} placeholder="%" />
                    <span className="text-sm text-slate-400">%</span>
                    <button onClick={() => removeParticipant(si, pi)} className="p-1 hover:bg-rose-50 rounded">
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={() => addParticipant(si)} className="text-sm text-primary-600 hover:underline flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Add Participant
              </button>
            </div>
          ))}
        </div>

        {splits.length === 0 && caps.length === 0 && (
          <div className="text-center py-8 text-slate-500">
            <Scissors className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p>No caps or splits configured</p>
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-slate-200">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Caps & Splits'}
        </button>
      </div>
    </div>
  );
}

// ==================== HELPER TRIPS TAB ====================
function HelperTripsTab({ plan }) {
  const { selectedPeriod } = useAppStore();
  const [rates, setRates] = useState([]);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewEmp, setPreviewEmp] = useState('');
  const [previewPeriod, setPreviewPeriod] = useState(selectedPeriod || new Date().toISOString().slice(0, 7));
  const [newTrip, setNewTrip] = useState({
    trip_number: '',
    trip_date: new Date().toISOString().slice(0, 10),
    trip_end_date: '',
    period: new Date().toISOString().slice(0, 7),
    stops_count: 10,
    distance_km: 50,
    participant_ids: [],
  });

  // Compute days inclusive — used for live preview in the form
  const computeDaysLocal = (start, end) => {
    if (!end || end === start) return 1;
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(s) || isNaN(e)) return 1;
    return Math.max(1, Math.round((e - s) / 86400000) + 1);
  };
  const [allEmployees, setAllEmployees] = useState([]);
  const [showNewTrip, setShowNewTrip] = useState(false);

  const planId = plan?.id || 'default';

  // Period to filter the trip log by — synced with header calendar, toggleable to "All"
  const [tripFilterPeriod, setTripFilterPeriod] = useState(selectedPeriod || new Date().toISOString().slice(0, 7));
  const [showAllPeriods, setShowAllPeriods] = useState(false);

  // Sync preview + filter period with header calendar
  useEffect(() => {
    if (selectedPeriod) {
      setPreviewPeriod(selectedPeriod);
      setTripFilterPeriod(selectedPeriod);
    }
  }, [selectedPeriod]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ratesRes, tripsRes, empRes] = await Promise.all([
        api.get(`/trips/rates/${planId}`),
        api.get('/trips'),
        api.get('/employees'),
      ]);
      setRates(ratesRes);
      setTrips(tripsRes);
      const deliveryEmps = empRes.filter(e =>
        ['role-helper', 'role-delivery', 'role-van-driver', 'role-van-sales', 'role-pre-sales', 'role-salesman'].includes(e.role_id)
      );
      setAllEmployees(deliveryEmps);
      // Auto-select first delivery employee so preview loads immediately
      if (deliveryEmps.length > 0 && !previewEmp) {
        setPreviewEmp(deliveryEmps[0].id);
      }
    } catch (err) {
      toast.error('Failed to load helper trips data');
    } finally {
      setLoading(false);
    }
  }, [planId, previewEmp]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Filter trips by selected period (unless "Show All" is on)
  const visibleTrips = showAllPeriods
    ? trips
    : trips.filter(t => t.period === tripFilterPeriod);

  // Distinct periods present in the trips data, plus the current selected period (even if empty)
  const availablePeriods = (() => {
    const set = new Set(trips.map(t => t.period).filter(Boolean));
    if (tripFilterPeriod) set.add(tripFilterPeriod);
    return Array.from(set).sort().reverse(); // newest first
  })();

  const updateRate = (idx, field, value) => {
    const updated = [...rates];
    updated[idx] = { ...updated[idx], [field]: value };
    setRates(updated);
  };

  const addRate = () => {
    const nextSize = rates.length > 0 ? Math.max(...rates.map(r => r.team_size)) + 1 : 1;
    setRates([...rates, { team_size: nextSize, rate_per_person: 0, currency: 'AED' }]);
  };

  const removeRate = (idx) => setRates(rates.filter((_, i) => i !== idx));

  const applyDefaults = () => {
    setRates([
      { team_size: 1, rate_per_person: 12, currency: 'AED' },
      { team_size: 2, rate_per_person: 7, currency: 'AED' },
      { team_size: 3, rate_per_person: 5, currency: 'AED' },
      { team_size: 4, rate_per_person: 4, currency: 'AED' },
    ]);
    toast.success('Default rates applied');
  };

  const saveRates = async () => {
    setSaving(true);
    try {
      await api.put(`/trips/rates/${planId}`, { rates });
      toast.success('Helper trip rates saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleParticipant = (empId) => {
    if (newTrip.participant_ids.includes(empId)) {
      setNewTrip({ ...newTrip, participant_ids: newTrip.participant_ids.filter(id => id !== empId) });
    } else {
      setNewTrip({ ...newTrip, participant_ids: [...newTrip.participant_ids, empId] });
    }
  };

  const createTrip = async () => {
    if (newTrip.participant_ids.length === 0) return toast.error('Select at least 1 participant');
    try {
      await api.post('/trips', newTrip);
      toast.success('Trip created');
      setShowNewTrip(false);
      setNewTrip({ ...newTrip, trip_number: '', participant_ids: [] });
      loadAll();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const previewForEmployee = async (empId, period) => {
    const emp = empId || previewEmp;
    const per = period || previewPeriod;
    if (!emp || !per) return;
    try {
      const res = await api.get(`/trips/commission/preview?employee_id=${emp}&period=${per}&plan_id=${planId}`);
      setPreview(res);
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Auto-refresh preview when employee or period changes
  useEffect(() => {
    if (previewEmp && previewPeriod) previewForEmployee(previewEmp, previewPeriod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewEmp, previewPeriod]);

  const computeRateForSize = (size) => {
    const sorted = [...rates].sort((a, b) => a.team_size - b.team_size);
    let rate = 0;
    for (const t of sorted) if (t.team_size <= size) rate = t.rate_per_person;
    return rate;
  };

  if (loading) return <div className="h-64 bg-slate-100 animate-pulse rounded" />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary-600" />
            Helper Trip Commission
          </h3>
          <p className="text-sm text-slate-500">
            Pay helpers per completed trip. Rate depends on team size (fewer helpers = higher per-person rate).
          </p>
        </div>
      </div>

      {/* Rate Configuration */}
      <div className="card p-5 bg-gradient-to-br from-sky-50/50 via-white to-emerald-50/50 border-sky-100 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-sky-100 text-sky-600 flex items-center justify-center flex-shrink-0">
            <Scale className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h4 className="font-semibold text-slate-900">Rate Table by Team Size</h4>
            <p className="text-sm text-slate-600">
              Define how much each helper earns based on how many people share the trip.
              <span className="block mt-1 text-xs text-slate-500">
                Example: 1 helper solo = 12 AED · 2 helpers sharing = 7 AED each · 3 helpers = 5 AED each
              </span>
            </p>
          </div>
          <button onClick={applyDefaults} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 whitespace-nowrap">
            Apply Defaults
          </button>
        </div>

        <div className="overflow-x-auto bg-white rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left py-2.5 px-4 font-medium text-slate-600">Team Size</th>
                <th className="text-right py-2.5 px-4 font-medium text-slate-600">Rate Per Person (AED)</th>
                <th className="text-center py-2.5 px-4 font-medium text-slate-600 hidden md:table-cell">Example</th>
                <th className="text-center py-2.5 px-4 font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-2 px-4">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        className="input w-20"
                        value={r.team_size}
                        onChange={e => updateRate(i, 'team_size', Number(e.target.value))}
                      />
                      <Users className="w-4 h-4 text-slate-400" />
                      <span className="text-xs text-slate-500">
                        {r.team_size === 1 ? 'Solo' : r.team_size === 2 ? 'Pair' : `Team of ${r.team_size}`}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 px-4 text-right">
                    <input
                      type="number"
                      step="0.01"
                      className="input w-28 text-right"
                      value={r.rate_per_person}
                      onChange={e => updateRate(i, 'rate_per_person', Number(e.target.value))}
                    />
                  </td>
                  <td className="py-2 px-4 text-center text-xs text-slate-500 hidden md:table-cell">
                    Each helper earns <strong className="text-slate-700">{r.rate_per_person} AED</strong> per trip
                  </td>
                  <td className="py-2 px-4 text-center">
                    <button onClick={() => removeRate(i)} className="p-1 hover:bg-rose-50 rounded">
                      <Trash2 className="w-4 h-4 text-rose-400" />
                    </button>
                  </td>
                </tr>
              ))}
              {rates.length === 0 && (
                <tr>
                  <td colSpan="4" className="text-center py-6 text-slate-400">
                    No rate tiers configured. Click "Apply Defaults" or "Add Tier".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={addRate} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-slate-200 hover:bg-slate-50">
            <Plus className="w-4 h-4" /> Add Tier
          </button>
          <button onClick={saveRates} disabled={saving} className="btn-primary flex items-center gap-1.5">
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Rates'}
          </button>
        </div>
      </div>

      {/* Trip Log */}
      <div className="card p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h4 className="font-semibold text-slate-900">Trip Log</h4>
            <p className="text-xs text-slate-500">
              {showAllPeriods
                ? `${trips.length} trips total (all periods)`
                : `${visibleTrips.length} trips in ${tripFilterPeriod} · ${trips.length} total`
              }
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="text-xs md:text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white font-medium min-w-[150px]"
              value={showAllPeriods ? '__ALL__' : tripFilterPeriod}
              onChange={e => {
                if (e.target.value === '__ALL__') {
                  setShowAllPeriods(true);
                } else {
                  setShowAllPeriods(false);
                  setTripFilterPeriod(e.target.value);
                }
              }}
            >
              <option value="__ALL__">📋 All Periods ({trips.length})</option>
              <optgroup label="Periods with trips">
                {availablePeriods.map(p => {
                  const count = trips.filter(t => t.period === p).length;
                  return (
                    <option key={p} value={p}>
                      {p} ({count} {count === 1 ? 'trip' : 'trips'})
                    </option>
                  );
                })}
              </optgroup>
            </select>
            <input
              type="month"
              className="text-xs md:text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white"
              value={tripFilterPeriod}
              title="Pick any month"
              onChange={e => {
                setShowAllPeriods(false);
                setTripFilterPeriod(e.target.value);
              }}
            />
            <button onClick={() => setShowNewTrip(!showNewTrip)} className="btn-primary flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Log New Trip
            </button>
          </div>
        </div>

        {/* New trip form */}
        {showNewTrip && (
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <div>
                <label className="label">Trip Number</label>
                <input className="input" value={newTrip.trip_number} onChange={e => setNewTrip({...newTrip, trip_number: e.target.value})} placeholder="TRIP-001" />
              </div>
              <div>
                <label className="label">Start Date</label>
                <input type="date" className="input" value={newTrip.trip_date} onChange={e => setNewTrip({...newTrip, trip_date: e.target.value, period: e.target.value.slice(0, 7)})} />
              </div>
              <div>
                <label className="label">End Date <span className="text-slate-400 text-xs">(optional)</span></label>
                <input type="date" className="input" value={newTrip.trip_end_date} min={newTrip.trip_date} onChange={e => setNewTrip({...newTrip, trip_end_date: e.target.value})} placeholder="same day" />
              </div>
              <div>
                <label className="label">Stops</label>
                <input type="number" className="input" value={newTrip.stops_count} onChange={e => setNewTrip({...newTrip, stops_count: Number(e.target.value)})} />
              </div>
              <div>
                <label className="label">Distance (km)</label>
                <input type="number" className="input" value={newTrip.distance_km} onChange={e => setNewTrip({...newTrip, distance_km: Number(e.target.value)})} />
              </div>
            </div>
            <div>
              <label className="label">Participants (click to toggle)</label>
              <div className="flex flex-wrap gap-1.5">
                {allEmployees.map(e => (
                  <button
                    key={e.id}
                    onClick={() => toggleParticipant(e.id)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
                      newTrip.participant_ids.includes(e.id)
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-primary-300'
                    )}
                  >
                    {e.name}
                  </button>
                ))}
              </div>
              {(() => {
                const days = computeDaysLocal(newTrip.trip_date, newTrip.trip_end_date);
                const size = newTrip.participant_ids.length;
                const rate = size > 0 ? computeRateForSize(size) : 0;
                const perPerson = rate * days;
                return (
                  <div className="mt-2 p-3 rounded-lg bg-white border border-emerald-200 text-sm">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span>
                        <strong>{size}</strong> helper{size !== 1 ? 's' : ''}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span>
                        <strong>{days}</strong> day{days !== 1 ? 's' : ''}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span>
                        Rate per person per day: <strong>{rate} AED</strong>
                      </span>
                      {size > 0 && (
                        <>
                          <span className="text-slate-400">=</span>
                          <span className="text-emerald-600 font-semibold">
                            {perPerson} AED each
                          </span>
                          <span className="text-slate-400 text-xs">
                            ({rate} × {days} day{days !== 1 ? 's' : ''})
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="flex gap-2">
              <button onClick={createTrip} className="btn-primary">Create Trip</button>
              <button onClick={() => setShowNewTrip(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
            </div>
          </div>
        )}

        {/* Trips table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-2 px-3 font-medium text-slate-600">Trip #</th>
                <th className="text-left py-2 px-3 font-medium text-slate-600">Dates</th>
                <th className="text-center py-2 px-3 font-medium text-slate-600">Days</th>
                <th className="text-left py-2 px-3 font-medium text-slate-600">Team</th>
                <th className="text-left py-2 px-3 font-medium text-slate-600 hidden md:table-cell">Participants</th>
                <th className="text-right py-2 px-3 font-medium text-slate-600">Per Person</th>
              </tr>
            </thead>
            <tbody>
              {visibleTrips.length === 0 && (
                <tr>
                  <td colSpan="6" className="py-8 text-center text-slate-400 text-sm">
                    No trips found for <strong>{tripFilterPeriod}</strong>.
                    {' '}
                    <button onClick={() => setShowAllPeriods(true)} className="underline text-primary-600">Show all periods</button>
                    {' '}or{' '}
                    <button onClick={() => setShowNewTrip(true)} className="underline text-primary-600">log a new trip</button>.
                  </td>
                </tr>
              )}
              {visibleTrips.slice(0, 50).map(t => {
                const days = t.days_count || computeDaysLocal(t.trip_date, t.trip_end_date);
                const rate = computeRateForSize(t.team_size);
                const total = rate * days;
                return (
                  <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3 font-mono text-xs">{t.trip_number}</td>
                    <td className="py-2 px-3 text-slate-500 text-xs">
                      {t.trip_date}
                      {t.trip_end_date && t.trip_end_date !== t.trip_date && <span className="text-slate-400"> → {t.trip_end_date}</span>}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span className={cn('badge', days > 1 ? 'badge-info' : 'badge-gray')}>{days}d</span>
                    </td>
                    <td className="py-2 px-3">
                      <span className={cn(
                        'badge',
                        t.team_size === 1 ? 'badge-success' : t.team_size === 2 ? 'badge-info' : 'badge-warning'
                      )}>
                        {t.team_size} {t.team_size === 1 ? 'helper' : 'helpers'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs hidden md:table-cell">
                      {t.participants?.map(p => p.employee_name).join(', ')}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="font-semibold text-emerald-600">{total} AED</div>
                      {days > 1 && <div className="text-[10px] text-slate-400">{rate} × {days}d</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visibleTrips.length > 50 && (
          <p className="text-xs text-slate-400 text-center">Showing first 50 of {visibleTrips.length} trips</p>
        )}
      </div>

      {/* Commission Preview */}
      <div className="card p-5 bg-gradient-to-br from-emerald-50/50 via-white to-teal-50/50 border-emerald-100">
        <h4 className="font-semibold text-slate-900 mb-2">Commission Preview</h4>
        <p className="text-xs text-slate-500 mb-3">
          Check how much an employee earned from helper trips in a selected period
          {selectedPeriod && <span className="ml-1">· synced with header calendar: <strong>{selectedPeriod}</strong></span>}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Employee</label>
            <select
              className="input"
              value={previewEmp}
              onChange={e => setPreviewEmp(e.target.value)}
            >
              <option value="">Select employee...</option>
              {allEmployees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Period</label>
            <input
              type="month"
              className="input"
              value={previewPeriod}
              onChange={e => setPreviewPeriod(e.target.value)}
            />
          </div>
        </div>
        {previewEmp && preview && preview.total_trips === 0 && (
          <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-start gap-2">
            <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>No trips found for this employee in <strong>{previewPeriod}</strong>. Try another period — the trip you just logged may be in a different month.</span>
          </div>
        )}

        {preview && (
          <div className="mt-4 p-4 rounded-lg bg-white border border-emerald-200 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
              <div>
                <div className="text-xs text-slate-500">Total Trips</div>
                <div className="text-xl font-bold text-slate-900">{preview.total_trips}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Total Days</div>
                <div className="text-xl font-bold text-indigo-600">{preview.total_days || 0}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Solo</div>
                <div className="text-xl font-bold text-emerald-600">{preview.solo_trips}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Paired</div>
                <div className="text-xl font-bold text-sky-600">{preview.paired_trips}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Team (3+)</div>
                <div className="text-xl font-bold text-amber-600">{preview.team_trips}</div>
              </div>
            </div>

            {/* Per-trip breakdown */}
            {preview.breakdown && preview.breakdown.length > 0 && (
              <div className="overflow-x-auto border-t border-slate-100 pt-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="text-left py-1.5 px-2">Trip</th>
                      <th className="text-left py-1.5 px-2">Dates</th>
                      <th className="text-center py-1.5 px-2">Days</th>
                      <th className="text-center py-1.5 px-2">Team</th>
                      <th className="text-right py-1.5 px-2">Rate/day</th>
                      <th className="text-right py-1.5 px-2">Earned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.breakdown.map(b => (
                      <tr key={b.id} className="border-t border-slate-50">
                        <td className="py-1.5 px-2 font-mono text-[10px]">{b.trip_number}</td>
                        <td className="py-1.5 px-2 text-slate-500">
                          {b.trip_date}
                          {b.trip_end_date && b.trip_end_date !== b.trip_date && <span className="text-slate-400"> → {b.trip_end_date}</span>}
                        </td>
                        <td className="py-1.5 px-2 text-center">{b.days_count}</td>
                        <td className="py-1.5 px-2 text-center">{b.team_size}</td>
                        <td className="py-1.5 px-2 text-right">{b.rate_per_person}</td>
                        <td className="py-1.5 px-2 text-right font-semibold text-emerald-600">{b.earned} AED</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600">Total Helper Commission:</span>
              <span className="text-2xl font-bold text-emerald-600">{preview.total_commission} AED</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

