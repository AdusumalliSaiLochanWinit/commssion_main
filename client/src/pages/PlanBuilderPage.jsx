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
  Truck, Users, CalendarDays, BadgePercent, Gift
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

/** Which PDF column(s) reference each KPI code (for labels — one KPI may appear in multiple PDF rows) */
const KSA_2025_KPI_PDF_TAGS = {
  OVERDUE_PCT: ['AMB TT/MM & FRZ', 'AMB WS/MT/OOH', 'AMB OOH'],
  RETURN_PERCENT: ['AMB TT/MM', 'AMB WS/MT/OOH', 'FRZ TT/MM', 'FRZ MT/OOH'],
  PRODUCTIVE_CALLS: ['AMB TT/MM', 'AMB WS/MT/OOH', 'FRZ TT/MM', 'FRZ MT/OOH'],
  SKU_PENETRATION: ['AMB TT/MM', 'AMB WS/MT/OOH', 'AMB OOH', 'FRZ TT/MM', 'FRZ MT/OOH'],
  ROUTE_ADHERENCE: ['AMB WS/MT/OOH', 'FRZ MT/OOH'],
  INV_DELIVERED: ['AMB OOH'],
  NEW_CUSTOMERS: ['AMB OOH'],
  IMAGE_VERIFY: ['FRZ TT/MM'],
  ZERO_SALES_OUTLET: ['Supervisor / ASM (PDF)'],
  OTD_PERCENT: ['Service level (PDF)'],
};

const KSA_2025_PDF_COLUMN_ROWS = [
  { segment: 'AMB (TT, MM) & FRZ all channels Salesman', kpis: 'Overdue · Bad Return · Productivity · Selected SKU' },
  { segment: 'AMB (WS – MT – OOH)', kpis: 'Overdue · Bad Return · JP Adherence · Selected SKU' },
  { segment: 'AMB OOH Salesman', kpis: 'Overdue · Bad Return · # Invoiced Customers · New Customer Acq. · Selected SKU' },
  { segment: 'FRZ (TT & MM) Salesman', kpis: 'Image Recognition · Bad Return · Productivity · Selected SKU' },
  { segment: 'FRZ (MT & OOH) Salesman', kpis: 'Bad Return · JP Adherence · Productivity · Selected SKU' },
];

/** Read-only PDF-style rows for Supervisor / ASM tab only */
const KSA_2025_SUPERVISOR_PDF_ROWS = [
  { segment: 'Supervisor & ASM — AMB (All Routes)', kpis: 'Overdue · Bad Return · JP Adherence · Zero-Sales Outlets' },
  { segment: 'Supervisor & ASM — FRZ', kpis: 'Image Recognition · Bad Return · JP Adherence · Zero-Sales Outlets' },
  { segment: 'Supervisor & ASM — OOH', kpis: 'Overdue · Bad Return · JP Adherence · OTD %' },
];

const KPI_PRESET_FIELD_KEYS = Object.keys(KPI_PRESETS).filter((k) => k !== 'supervisor');
const KPI_PRESET_SUPERVISOR_KEY = 'supervisor';

function ksaPdfTagsForCode(code) {
  return KSA_2025_KPI_PDF_TAGS[code] || [];
}

/** KSA PDF: 5 salesman / channel monitoring rows × 4 KPIs each (system codes) */
const KSA_FIVE_SALESMAN_MONITOR_GROUPS = [
  {
    key: 'ksa-amb-tt-mm-frz-allch-salesman',
    n: 1,
    title: 'AMB (TT, MM) & FRZ — all channels Salesman',
    short: 'TT/MM + FRZ',
    kpiCodes: ['OVERDUE_PCT', 'RETURN_PERCENT', 'PRODUCTIVE_CALLS', 'SKU_PENETRATION'],
    /** When no roles are selected on a new plan, restrict to these role ids */
    defaultRoleIds: ['role-salesman'],
  },
  {
    key: 'ksa-amb-ws-mt-ooh',
    n: 2,
    title: 'AMB (WS – MT – OOH)',
    short: 'WS/MT/OOH',
    kpiCodes: ['OVERDUE_PCT', 'RETURN_PERCENT', 'ROUTE_ADHERENCE', 'SKU_PENETRATION'],
    defaultRoleIds: ['role-salesman'],
  },
  {
    key: 'ksa-amb-ooh-salesman',
    n: 3,
    title: 'AMB OOH Salesman',
    short: 'OOH',
    kpiCodes: ['OVERDUE_PCT', 'RETURN_PERCENT', 'NEW_CUSTOMERS', 'SKU_PENETRATION'],
    defaultRoleIds: ['role-salesman'],
  },
  {
    key: 'ksa-frz-tt-mm-salesman',
    n: 4,
    title: 'FRZ (TT & MM) Salesman',
    short: 'FRZ TT/MM',
    kpiCodes: ['IMAGE_VERIFY', 'RETURN_PERCENT', 'PRODUCTIVE_CALLS', 'SKU_PENETRATION'],
    defaultRoleIds: ['role-salesman'],
  },
  {
    key: 'ksa-frz-mt-ooh-salesman',
    n: 5,
    title: 'FRZ (MT & OOH) Salesman',
    short: 'FRZ MT/OOH',
    kpiCodes: ['RETURN_PERCENT', 'ROUTE_ADHERENCE', 'PRODUCTIVE_CALLS', 'SKU_PENETRATION'],
    defaultRoleIds: ['role-salesman'],
  },
];

/** KPI rows for plan state (matches API GET shape) from a KSA salesman segment */
function planKpisFromKsaSegment(segment, allKpis) {
  if (!segment?.kpiCodes?.length || !allKpis?.length) return [];
  const resolved = segment.kpiCodes.map((code) => allKpis.find((k) => k.code === code)).filter(Boolean);
  const n = resolved.length;
  const baseW = n ? Math.floor(100 / n) : 0;
  const remainder = n ? 100 - baseW * n : 0;
  return resolved.map((kpi, i) => ({
    kpi_id: kpi.id,
    kpi_name: kpi.name,
    kpi_code: kpi.code,
    kpi_category: kpi.category,
    unit: kpi.unit,
    target_value: suggestTarget(kpi),
    weight: i === 0 ? baseW + remainder : baseW,
    slab_set_id: null,
  }));
}

function inferKsaSalesmanSegmentKey(plan) {
  const codes = (plan.kpis || []).map((k) => k.kpi_code).filter(Boolean);
  const sorted = [...codes].sort().join(',');
  for (const g of KSA_FIVE_SALESMAN_MONITOR_GROUPS) {
    const need = [...g.kpiCodes].sort().join(',');
    if (need === sorted && codes.length === g.kpiCodes.length) return g.key;
  }
  return null;
}

const KSA_SALESMAN_SEGMENT_CREATE_OPTIONS = KSA_FIVE_SALESMAN_MONITOR_GROUPS;

/** KSA PDF: Supervisors / ASM monitoring rows × 4 KPIs each (system codes) */
const KSA_THREE_SUPERVISOR_MONITOR_GROUPS = [
  {
    n: 1,
    title: 'Supervisor & ASM — AMB (All Routes)',
    short: 'AMB',
    kpiCodes: ['OVERDUE_PCT', 'RETURN_PERCENT', 'ROUTE_ADHERENCE', 'ZERO_SALES_OUTLET'],
  },
  {
    n: 2,
    title: 'Supervisor & ASM — FRZ',
    short: 'FRZ',
    kpiCodes: ['IMAGE_VERIFY', 'RETURN_PERCENT', 'ROUTE_ADHERENCE', 'ZERO_SALES_OUTLET'],
  },
  {
    n: 3,
    title: 'Supervisor & ASM — OOH',
    short: 'OOH',
    kpiCodes: ['OVERDUE_PCT', 'RETURN_PERCENT', 'ROUTE_ADHERENCE', 'OTD_PERCENT'],
  },
];

const tabs = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'kpis', label: 'KPIs & Weights', icon: Target },
  { id: 'helper-trips', label: 'Helper Cases', icon: Truck },
  { id: 'slabs', label: 'Slabs', icon: BarChart3 },
  { id: 'monthly-targets', label: 'Monthly Targets', icon: CalendarDays },
  { id: 'kpi-deductions', label: 'KPI Deductions', icon: BadgePercent },
  { id: 'fixed-incentives', label: 'Fixed Incentives', icon: Gift },
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
      if (planData) {
        setPlan({
          ...planData,
          kpi_segment_key: inferKsaSalesmanSegmentKey(planData) ?? null,
        });
      } else {
        setPlan({
          name: '', description: '', status: 'draft', plan_type: 'monthly',
          effective_from: '2026-01-01', effective_to: '2026-12-31', base_payout: 15000,
          roles: [], territories: [], kpis: [], slab_sets: [], rule_sets: [],
          eligibility_rules: [], multiplier_rules: [], penalty_rules: [],
          capping_rules: [], split_rules: [],
          /** New plans start manual; user selects channel-specific KPI profile as needed */
          kpi_segment_key: null,
        });
      }
    }).catch(() => {
      toast.error('Failed to load plan data');
    }).finally(() => setLoading(false));
  }, [id]);

  if (loading || !plan) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-neutral-200 rounded animate-pulse" />
        <div className="card p-8">
          <div className="h-96 bg-neutral-100 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
        <button onClick={() => navigate('/plans')} className="p-2 hover:bg-neutral-100 rounded-lg transition-colors self-start">
          <ArrowLeft className="w-5 h-5 text-neutral-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl md:text-2xl font-bold text-neutral-900">
            {plan.id ? plan.name : 'New Commission Plan'}
          </h1>
          {plan.id && (
            <div className="flex items-center gap-3 mt-1">
              <span className={cn('badge', getStatusColor(plan.status))}>{getStatusLabel(plan.status)}</span>
              <span className="text-sm text-neutral-500">{plan.plan_type}</span>
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
            className="px-4 py-2 text-sm font-medium rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50 flex items-center gap-2"
          >
            Move to Draft
          </button>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-neutral-200">
        <div className="flex gap-1 overflow-x-auto pb-px">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700 hover:border-neutral-300'
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
        {activeTab === 'general' && (
          <GeneralTab
            plan={plan}
            setPlan={setPlan}
            allRoles={allRoles}
            allTerritories={allTerritories}
            allKpis={allKpis}
            navigate={navigate}
          />
        )}
        {activeTab === 'kpis' && <KpisTab plan={plan} setPlan={setPlan} allKpis={allKpis} />}
        {activeTab === 'helper-trips' && <HelperTripsTab plan={plan} />}
        {activeTab === 'slabs' && <SlabsTab plan={plan} setPlan={setPlan} allKpis={allKpis} allRoles={allRoles} />}
        {activeTab === 'monthly-targets' && <MonthlyTargetsTab plan={plan} setPlan={setPlan} allKpis={allKpis} allRoles={allRoles} />}
        {activeTab === 'kpi-deductions' && <KpiDeductionsTab plan={plan} setPlan={setPlan} allKpis={allKpis} allRoles={allRoles} />}
        {activeTab === 'fixed-incentives' && <FixedIncentivesTab plan={plan} setPlan={setPlan} allKpis={allKpis} allRoles={allRoles} />}
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

function GeneralTab({ plan, setPlan, allRoles, allTerritories, allKpis, navigate }) {
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!plan.name) return toast.error('Plan name is required');
    setSaving(true);
    try {
      if (!plan.id) {
        const segment = plan.kpi_segment_key
          ? KSA_FIVE_SALESMAN_MONITOR_GROUPS.find((g) => g.key === plan.kpi_segment_key)
          : null;
        let rolesToSave = plan.roles || [];
        if (segment?.defaultRoleIds?.length && rolesToSave.length === 0) {
          rolesToSave = allRoles.filter((r) => segment.defaultRoleIds.includes(r.id));
        }

        const created = await api.post('/plans', {
          name: plan.name, description: plan.description, plan_type: plan.plan_type,
          effective_from: plan.effective_from, effective_to: plan.effective_to,
          base_payout: plan.base_payout, created_by: 'admin',
        });
        if (rolesToSave.length > 0) {
          await api.put(`/plans/${created.id}/roles`, { role_ids: rolesToSave.map((r) => r.id) });
        }
        if ((plan.territories || []).length > 0) {
          await api.put(`/plans/${created.id}/territories`, { territory_ids: plan.territories.map((t) => t.id) });
        }
        if (segment && allKpis.length > 0) {
          const rows = planKpisFromKsaSegment(segment, allKpis);
          if (rows.length > 0) {
            await api.put(`/plans/${created.id}/kpis`, {
              kpis: rows.map((k) => ({
                kpi_id: k.kpi_id,
                weight: k.weight,
                target_value: k.target_value,
                slab_set_id: k.slab_set_id,
              })),
            });
          }
        }
        toast.success(segment ? 'Plan created with segment KPIs' : 'Plan created');
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
      {!plan.id && (
        <div className="p-4 rounded-lg border border-primary-200 bg-primary-50/40 space-y-2">
          <label className="label">KPI profile (per plan)</label>
          <p className="text-xs text-neutral-600 -mt-1">
            Choose how this plan starts on the KPIs tab. You can select a channel-specific salesman KPI profile per plan (saved only for this plan).
          </p>
          <select
            className="input max-w-xl"
            value={plan.kpi_segment_key || ''}
            onChange={(e) =>
              setPlan({
                ...plan,
                kpi_segment_key: e.target.value || null,
              })
            }
          >
            <option value="">Manual — empty KPIs until you add them</option>
            {KSA_SALESMAN_SEGMENT_CREATE_OPTIONS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.title}
              </option>
            ))}
          </select>
        </div>
      )}
      {plan.id && plan.kpi_segment_key && (
        <div className="text-sm text-neutral-600 flex flex-wrap items-center gap-2">
          <span className="font-medium text-neutral-800">KPI profile:</span>
          <span className="px-2 py-0.5 rounded-md bg-neutral-100 border border-neutral-200">
            {KSA_FIVE_SALESMAN_MONITOR_GROUPS.find((g) => g.key === plan.kpi_segment_key)?.title || 'Custom'}
          </span>
          <span className="text-xs text-neutral-500">(inferred from KPI list or chosen at creation)</span>
        </div>
      )}

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
                  selected ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'
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
                  selected ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50'
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

      <div className="pt-4 border-t border-neutral-200">
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
  const [pdfRefOpen, setPdfRefOpen] = useState(true);
  const [supPdfRefOpen, setSupPdfRefOpen] = useState(true);
  /** Keep plan weights, salesman PDF layout, and supervisor layout on separate screens */
  const [kpiUiSection, setKpiUiSection] = useState('plan-weights');

  const toggleKpiHelper = () => {
    if (helperOpen) setHelperOpen(false);
    else {
      setKpiUiSection('plan-weights');
      setHelperOpen(true);
    }
  };

  const payoutKpis = planKpis.filter(pk => (pk.kpi_code || '') === 'TOTAL_REVENUE');
  const monitoringKpis = planKpis.filter(pk => (pk.kpi_code || '') !== 'TOTAL_REVENUE');

  const codePrimarySalesmanGroup = {};
  KSA_FIVE_SALESMAN_MONITOR_GROUPS.forEach((g) => {
    g.kpiCodes.forEach((code) => {
      if (codePrimarySalesmanGroup[code] === undefined) codePrimarySalesmanGroup[code] = g.n;
    });
  });

  const codePrimarySupervisorGroup = {};
  KSA_THREE_SUPERVISOR_MONITOR_GROUPS.forEach((g) => {
    g.kpiCodes.forEach((code) => {
      if (codePrimarySupervisorGroup[code] === undefined) codePrimarySupervisorGroup[code] = g.n;
    });
  });

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
    const nextKpis = [...planKpis, {
      kpi_id: kpi.id, kpi_name: kpi.name, kpi_code: kpi.code, kpi_category: kpi.category,
      unit: kpi.unit, target_value: target, weight: customWeight, slab_set_id: null,
    }];
    setPlan({
      ...plan,
      kpis: nextKpis,
      kpi_segment_key: inferKsaSalesmanSegmentKey({ ...plan, kpis: nextKpis }),
    });
    setAddKpiId('');
  };

  const updateKpi = (idx, field, value) => {
    const updated = [...planKpis];
    updated[idx] = {...updated[idx], [field]: value};
    setPlan({...plan, kpis: updated});
  };

  const removeKpi = (idx) => {
    const nextKpis = planKpis.filter((_, i) => i !== idx);
    setPlan({
      ...plan,
      kpis: nextKpis,
      kpi_segment_key: inferKsaSalesmanSegmentKey({ ...plan, kpis: nextKpis }),
    });
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
    setPlan({...plan, kpis: newKpis, kpi_segment_key: null });
    toast.success(`Applied "${preset.label}" template — ${newKpis.length} KPIs${skipped ? ` (${skipped} skipped)` : ''}`);
    setHelperOpen(false);
  };

  const applyKsaSalesmanSegment = (segmentKey) => {
    const segment = KSA_FIVE_SALESMAN_MONITOR_GROUPS.find((g) => g.key === segmentKey);
    if (!segment) return;
    const newKpis = planKpisFromKsaSegment(segment, allKpis);
    if (newKpis.length === 0) {
      toast.error('KPI definitions not loaded or codes missing');
      return;
    }
    setPlan({ ...plan, kpis: newKpis, kpi_segment_key: segment.key });
    toast.success(`Applied "${segment.title}" — ${newKpis.length} KPIs (this plan only)`);
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
    setPlan({ ...plan, kpis: [], kpi_segment_key: null });
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
          <h3 className="font-semibold text-neutral-900">KPI Configuration</h3>
          <p className="text-sm text-neutral-500">Assign KPIs, set targets, and allocate weights (must sum to 100%)</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={toggleKpiHelper}
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

      {/* ============ KPI CONFIG HELPER (only on Plan KPIs & weights — keeps templates off KSA layout tabs) ============ */}
      {helperOpen && kpiUiSection === 'plan-weights' && (
        <div className="card p-5 bg-gradient-to-br from-violet-50/50 via-white to-sky-50/50 border-violet-100 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-semibold text-neutral-900">Quick Setup Helper</h4>
              <p className="text-sm text-neutral-600">
                Field and route presets are separate from the supervisor preset. KSA PDF-style grids live on the <strong>KSA — Salesman</strong> and <strong>KSA — Supervisor / ASM</strong> tabs.
              </p>
            </div>
          </div>

          {/* ---- Preset Templates — field & route (not supervisor) ---- */}
          <div>
            <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
              Step 1a — Field & route roles (optional)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {KPI_PRESET_FIELD_KEYS.map((key) => {
                const preset = KPI_PRESETS[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyPreset(key)}
                    className="text-left p-3 rounded-lg border border-neutral-200 bg-white hover:border-violet-300 hover:bg-violet-50/50 transition-colors group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm text-neutral-900 group-hover:text-violet-700">
                        {preset.label}
                      </span>
                      <span className="text-xs text-neutral-400">{preset.kpis.length} KPIs</span>
                    </div>
                    <p className="text-xs text-neutral-500 leading-snug">{preset.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
              Step 1b — Supervisor / ASM (management)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {(() => {
                const preset = KPI_PRESETS[KPI_PRESET_SUPERVISOR_KEY];
                return (
                  <button
                    type="button"
                    onClick={() => applyPreset(KPI_PRESET_SUPERVISOR_KEY)}
                    className="text-left p-3 rounded-lg border border-amber-200 bg-amber-50/60 hover:bg-amber-100/80 transition-colors group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm text-neutral-900 group-hover:text-amber-900">
                        {preset.label}
                      </span>
                      <span className="text-xs text-neutral-500">{preset.kpis.length} KPIs</span>
                    </div>
                    <p className="text-xs text-neutral-600 leading-snug">{preset.description}</p>
                  </button>
                );
              })()}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
              KSA 2025 — per-plan salesman monitoring (PDF)
            </div>
            <p className="text-xs text-neutral-600 mb-2">
              Replaces KPIs on <strong>this plan only</strong> with the four monitoring metrics for the selected salesman segment.
            </p>
            <div className="flex flex-wrap gap-2">
              {KSA_SALESMAN_SEGMENT_CREATE_OPTIONS.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => applyKsaSalesmanSegment(g.key)}
                  className="text-left px-3 py-2 rounded-lg border border-sky-200 bg-sky-50/80 hover:bg-sky-100 text-sm text-sky-900 font-medium transition-colors max-w-md"
                >
                  Apply: {g.title}
                </button>
              ))}
            </div>
          </div>

          {/* ---- Quick Actions ---- */}
          <div className="flex flex-wrap gap-2 pt-3 border-t border-violet-100">
            <button
              onClick={autoBalanceWeights}
              disabled={planKpis.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Scale className="w-4 h-4" /> Auto-Balance Weights
            </button>
            <button
              onClick={clearAll}
              disabled={planKpis.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-neutral-200 text-rose-600 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Clear All
            </button>
          </div>

          {/* ---- Category Browser ---- */}
          <div>
            <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">
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
                      : 'bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                  )}
                >
                  {cat === 'all' ? `All (${allKpis.length})` : `${cat} (${kpisByCategory[cat].length})`}
                </button>
              ))}
            </div>
            <div className="max-h-64 overflow-y-auto border border-neutral-200 rounded-lg bg-white divide-y divide-neutral-100">
              {filteredKpis.map(k => {
                const already = planKpis.some(pk => pk.kpi_id === k.id);
                return (
                  <div key={k.id} className="flex items-center justify-between px-3 py-2 hover:bg-neutral-50">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-neutral-900 truncate">{k.name}</div>
                      <div className="text-xs text-neutral-500 truncate">
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

      <div className="flex flex-wrap gap-2 border-b border-neutral-200 pb-3">
        {[
          { id: 'plan-weights', label: 'Plan KPIs & weights' },
          { id: 'ksa-salesman', label: 'KSA — Salesman layout' },
          { id: 'ksa-supervisor', label: 'KSA — Supervisor / ASM' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setKpiUiSection(tab.id)}
            className={cn(
              'px-3 py-2 text-sm font-medium rounded-lg border transition-colors',
              kpiUiSection === tab.id
                ? 'border-primary-300 bg-primary-50 text-primary-800'
                : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ============ WEIGHT WARNING (plan list only) ============ */}
      {kpiUiSection === 'plan-weights' && planKpis.length > 0 && totalWeight !== 100 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm">
          <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-amber-800">
            Weights total <strong>{totalWeight}%</strong> — must equal <strong>100%</strong> before calculation.
            {' '}
            <button type="button" onClick={autoBalanceWeights} className="underline font-medium hover:no-underline">
              Auto-balance now
            </button>
          </div>
        </div>
      )}

      {/* ============ Plan KPIs & weights: tables + helper context ============ */}
      {kpiUiSection === 'plan-weights' && (
        <>
          <p className="text-sm text-neutral-600">
            Use this tab for <strong>weights, targets, and the full KPI list</strong>. Open <strong>KPI Helper</strong> for presets and the library.
            PDF-style salesman and supervisor grids are on their own tabs so field and supervisor setups are not mixed here.
          </p>
          {planKpis.length > 0 && (
            <div className="space-y-6">
              {payoutKpis.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-neutral-900 mb-1">1 — Sales achievement (payout driver)</h4>
                  <p className="text-xs text-neutral-500 mb-2">Keep <strong>TOTAL_REVENUE</strong> at <strong>100%</strong> weight for KSA slab commission. Targets & monthly overrides can be set per period in Monthly Targets.</p>
                  <div className="overflow-x-auto card">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-neutral-200 bg-neutral-50">
                          <th className="text-left py-3 px-4 font-medium text-neutral-600">KPI</th>
                          <th className="text-left py-3 px-4 font-medium text-neutral-600 hidden lg:table-cell">KSA (PDF)</th>
                          <th className="text-left py-3 px-4 font-medium text-neutral-600 hidden md:table-cell">Category</th>
                          <th className="text-right py-3 px-4 font-medium text-neutral-600">Target</th>
                          <th className="text-right py-3 px-4 font-medium text-neutral-600">Weight %</th>
                          <th className="text-center py-3 px-4 font-medium text-neutral-600">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payoutKpis.map((pk) => {
                          const i = planKpis.findIndex(p => p.kpi_id === pk.kpi_id);
                          return (
                            <tr key={pk.kpi_id} className="border-b border-neutral-100">
                              <td className="py-3 px-4">
                                <div className="font-medium text-neutral-900">{pk.kpi_name}</div>
                                <div className="text-xs text-neutral-400">{pk.kpi_code} · {pk.unit}</div>
                              </td>
                              <td className="py-3 px-4 hidden lg:table-cell text-xs text-neutral-500 max-w-[220px]">Slab payout via achievement % (see Slabs tab by role)</td>
                              <td className="py-3 px-4 hidden md:table-cell"><span className="badge badge-gray">{pk.kpi_category}</span></td>
                              <td className="py-2 px-4 text-right">
                                <input type="number" className="input w-28 text-right" value={pk.target_value}
                                  onChange={e => updateKpi(i, 'target_value', Number(e.target.value))} />
                              </td>
                              <td className="py-2 px-4 text-right">
                                <input type="number" className="input w-20 text-right" value={pk.weight}
                                  onChange={e => updateKpi(i, 'weight', Number(e.target.value))} />
                              </td>
                              <td className="py-3 px-4 text-center">
                                <button type="button" onClick={() => removeKpi(i)} className="p-1 hover:bg-rose-50 rounded" title="Remove from plan">
                                  <Trash2 className="w-4 h-4 text-rose-400" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold text-neutral-900 mb-1">2 — Monitoring KPIs (typically weight 0 — deductions)</h4>
                <p className="text-xs text-neutral-500 mb-2">
                  Used for <strong>KPI Deductions</strong> and achievement checks. The <strong>PDF tags</strong> column shows where each KPI appears in the KSA PDF; use the <strong>KSA — Salesman</strong> or <strong>Supervisor / ASM</strong> tab for row-by-row PDF layout cards.
                </p>

                {monitoringKpis.length > 0 && (
                  <>
                    <p className="text-xs font-medium text-neutral-600 mb-2">All monitoring KPIs (full list)</p>
                    <div className="overflow-x-auto card">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-neutral-200 bg-neutral-50">
                            <th className="text-left py-3 px-4 font-medium text-neutral-600">KPI</th>
                            <th className="text-left py-3 px-4 font-medium text-neutral-600 hidden lg:table-cell">PDF tags</th>
                            <th className="text-left py-3 px-4 font-medium text-neutral-600 hidden md:table-cell">Category</th>
                            <th className="text-right py-3 px-4 font-medium text-neutral-600">Target</th>
                            <th className="text-right py-3 px-4 font-medium text-neutral-600">Weight %</th>
                            <th className="text-center py-3 px-4 font-medium text-neutral-600">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...monitoringKpis].sort((a, b) => (a.kpi_code || '').localeCompare(b.kpi_code || '')).map((pk) => {
                            const i = planKpis.findIndex(p => p.kpi_id === pk.kpi_id);
                            const tags = ksaPdfTagsForCode(pk.kpi_code || '');
                            return (
                              <tr key={pk.kpi_id} className="border-b border-neutral-100">
                                <td className="py-3 px-4">
                                  <div className="font-medium text-neutral-900">{pk.kpi_name}</div>
                                  <div className="text-xs text-neutral-400">
                                    {pk.kpi_code} · {pk.unit}
                                    <span className="md:hidden ml-2 badge badge-gray text-[10px]">{pk.kpi_category}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-4 hidden lg:table-cell align-top">
                                  {tags.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {tags.map(t => (
                                        <span key={t} className="inline-flex px-1.5 py-0.5 rounded text-[10px] bg-sky-50 text-sky-800 border border-sky-100">{t}</span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-neutral-400">—</span>
                                  )}
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
                                  <button type="button" onClick={() => removeKpi(i)} className="p-1 hover:bg-rose-50 rounded">
                                    <Trash2 className="w-4 h-4 text-rose-400" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ============ KSA — Salesman PDF layout (no supervisor cards here) ============ */}
      {kpiUiSection === 'ksa-salesman' && (
        <div className="space-y-5">
          <p className="text-sm text-neutral-600">
            Salesman monitoring rows from the KSA PDF only. Targets and weights here update the same plan KPIs as on <strong>Plan KPIs & weights</strong>.
          </p>
          <div className="border border-neutral-200 rounded-lg overflow-hidden bg-neutral-50/50">
            <button
              type="button"
              onClick={() => setPdfRefOpen(!pdfRefOpen)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-neutral-100/80 transition-colors"
            >
              <span className="font-medium text-neutral-800">KSA 2025 PDF — Salesman segments (read-only)</span>
              <ChevronDown className={cn('w-4 h-4 text-neutral-500 transition-transform', pdfRefOpen && 'rotate-180')} />
            </button>
            {pdfRefOpen && (
              <div className="px-4 pb-4 border-t border-neutral-200 bg-white">
                <p className="text-xs text-neutral-500 mt-3 mb-2">
                  Sales achievement amounts differ by <strong>role</strong> (see <strong>Slabs</strong>). Supervisor rows are on the <strong>KSA — Supervisor / ASM</strong> tab.
                </p>
                <div className="overflow-x-auto rounded border border-neutral-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-neutral-100 text-left">
                        <th className="py-2 px-2 font-medium text-neutral-600">PDF segment</th>
                        <th className="py-2 px-2 font-medium text-neutral-600">Typical monitoring KPIs (PDF)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {KSA_2025_PDF_COLUMN_ROWS.map((row, ri) => (
                        <tr key={ri} className="border-t border-neutral-100">
                          <td className="py-2 px-2 text-neutral-800 align-top whitespace-nowrap">{row.segment}</td>
                          <td className="py-2 px-2 text-neutral-600">{row.kpis}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {planKpis.length > 0 ? (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-neutral-600 uppercase tracking-wide">Salesman (KSA PDF) — 5 types × 4 KPIs</div>
              <p className="text-xs text-neutral-500 -mt-1 mb-2">
                Each card is one PDF row. Shared KPIs are edited once in the <strong>first</strong> card where they appear.
              </p>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {KSA_FIVE_SALESMAN_MONITOR_GROUPS.map((grp) => (
                  <div key={grp.n} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="text-xs font-semibold text-violet-700">Type {grp.n} · {grp.short}</div>
                        <div className="text-sm font-medium text-neutral-900 leading-snug">{grp.title}</div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">4 KPIs</span>
                    </div>
                    <ul className="space-y-2">
                      {grp.kpiCodes.map((code) => {
                        const def = allKpis.find(k => k.code === code);
                        const pk = monitoringKpis.find(k => (k.kpi_code || '') === code);
                        const i = pk ? planKpis.findIndex(p => p.kpi_id === pk.kpi_id) : -1;
                        const isPrimary = codePrimarySalesmanGroup[code] === grp.n;
                        return (
                          <li key={`${grp.n}-${code}`} className="text-xs border-t border-neutral-100 pt-2 first:border-t-0 first:pt-0">
                            <div className="font-medium text-neutral-800">{def?.name || code}</div>
                            <div className="text-[10px] text-neutral-400 font-mono mb-1">{code}</div>
                            {!def && (
                              <span className="text-rose-600">No KPI definition in library</span>
                            )}
                            {def && !pk && (
                              <button
                                type="button"
                                onClick={() => addKpi(def.id, 0, suggestTarget(def))}
                                className="text-[11px] text-violet-600 hover:underline"
                              >
                                + Add to plan
                              </button>
                            )}
                            {def && pk && isPrimary && i >= 0 && (
                              <div className="flex flex-wrap items-center gap-2 mt-1">
                                <span className="text-neutral-500">Target</span>
                                <input type="number" className="input w-20 text-right h-7 text-xs"
                                  value={pk.target_value}
                                  onChange={e => updateKpi(i, 'target_value', Number(e.target.value))} />
                                <span className="text-neutral-500">Wt%</span>
                                <input type="number" className="input w-14 text-right h-7 text-xs"
                                  value={pk.weight}
                                  onChange={e => updateKpi(i, 'weight', Number(e.target.value))} />
                              </div>
                            )}
                            {def && pk && !isPrimary && (
                              <p className="text-[11px] text-neutral-500 mt-0.5">
                                Shared KPI — edit under <strong>Type {codePrimarySalesmanGroup[code]}</strong> here, or use <strong>Plan KPIs & weights</strong> for the full table.
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-neutral-500 py-4">
              No KPIs on this plan yet. Switch to <button type="button" className="text-violet-600 font-medium underline" onClick={() => { setKpiUiSection('plan-weights'); setHelperOpen(true); }}>Plan KPIs & weights</button> and open KPI Helper to add KPIs.
            </p>
          )}
        </div>
      )}

      {/* ============ KSA — Supervisor / ASM (no salesman cards here) ============ */}
      {kpiUiSection === 'ksa-supervisor' && (
        <div className="space-y-5">
          <p className="text-sm text-neutral-600">
            Supervisor and ASM monitoring rows only. Slab rules for management roles are configured separately on the <strong>Slabs</strong> tab by role.
          </p>
          <div className="border border-neutral-200 rounded-lg overflow-hidden bg-neutral-50/50">
            <button
              type="button"
              onClick={() => setSupPdfRefOpen(!supPdfRefOpen)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-neutral-100/80 transition-colors"
            >
              <span className="font-medium text-neutral-800">KSA 2025 PDF — Supervisor / ASM segments (read-only)</span>
              <ChevronDown className={cn('w-4 h-4 text-neutral-500 transition-transform', supPdfRefOpen && 'rotate-180')} />
            </button>
            {supPdfRefOpen && (
              <div className="px-4 pb-4 border-t border-neutral-200 bg-white">
                <div className="overflow-x-auto rounded border border-neutral-100 mt-3">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-neutral-100 text-left">
                        <th className="py-2 px-2 font-medium text-neutral-600">PDF segment</th>
                        <th className="py-2 px-2 font-medium text-neutral-600">Typical monitoring KPIs (PDF)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {KSA_2025_SUPERVISOR_PDF_ROWS.map((row, ri) => (
                        <tr key={ri} className="border-t border-neutral-100">
                          <td className="py-2 px-2 text-neutral-800 align-top whitespace-nowrap">{row.segment}</td>
                          <td className="py-2 px-2 text-neutral-600">{row.kpis}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {planKpis.length > 0 ? (
            <div className="space-y-3">
              <div className="text-xs font-semibold text-neutral-600 uppercase tracking-wide">Supervisors / ASM (KSA PDF) — 3 types × 4 KPIs</div>
              <p className="text-xs text-neutral-500 -mt-1 mb-2">
                Each card is one supervisor/ASM PDF row. Shared KPIs are edited once in the <strong>first</strong> card where they appear.
              </p>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {KSA_THREE_SUPERVISOR_MONITOR_GROUPS.map((grp) => (
                  <div key={`sup-${grp.n}`} className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="text-xs font-semibold text-sky-700">Type {grp.n} · {grp.short}</div>
                        <div className="text-sm font-medium text-neutral-900 leading-snug">{grp.title}</div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-600">4 KPIs</span>
                    </div>
                    <ul className="space-y-2">
                      {grp.kpiCodes.map((code) => {
                        const def = allKpis.find(k => k.code === code);
                        const pk = monitoringKpis.find(k => (k.kpi_code || '') === code);
                        const i = pk ? planKpis.findIndex(p => p.kpi_id === pk.kpi_id) : -1;
                        const isPrimary = codePrimarySupervisorGroup[code] === grp.n;
                        return (
                          <li key={`sup-${grp.n}-${code}`} className="text-xs border-t border-neutral-100 pt-2 first:border-t-0 first:pt-0">
                            <div className="font-medium text-neutral-800">{def?.name || code}</div>
                            <div className="text-[10px] text-neutral-400 font-mono mb-1">{code}</div>
                            {!def && (
                              <span className="text-rose-600">No KPI definition in library</span>
                            )}
                            {def && !pk && (
                              <button
                                type="button"
                                onClick={() => addKpi(def.id, 0, suggestTarget(def))}
                                className="text-[11px] text-sky-600 hover:underline"
                              >
                                + Add to plan
                              </button>
                            )}
                            {def && pk && isPrimary && i >= 0 && (
                              <div className="flex flex-wrap items-center gap-2 mt-1">
                                <span className="text-neutral-500">Target</span>
                                <input type="number" className="input w-20 text-right h-7 text-xs"
                                  value={pk.target_value}
                                  onChange={e => updateKpi(i, 'target_value', Number(e.target.value))} />
                                <span className="text-neutral-500">Wt%</span>
                                <input type="number" className="input w-14 text-right h-7 text-xs"
                                  value={pk.weight}
                                  onChange={e => updateKpi(i, 'weight', Number(e.target.value))} />
                              </div>
                            )}
                            {def && pk && !isPrimary && (
                              <p className="text-[11px] text-neutral-500 mt-0.5">
                                Shared KPI — edit under <strong>Type {codePrimarySupervisorGroup[code]}</strong> here, or use <strong>Plan KPIs & weights</strong> for the full table.
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-neutral-500 py-4">
              No KPIs on this plan yet. Switch to <button type="button" className="text-violet-600 font-medium underline" onClick={() => { setKpiUiSection('plan-weights'); setHelperOpen(true); }}>Plan KPIs & weights</button> and open KPI Helper (supervisor preset under Step 1b).
            </p>
          )}
        </div>
      )}

      {kpiUiSection === 'plan-weights' && planKpis.length > 0 && payoutKpis.length === 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            KSA commission needs <strong>TOTAL_REVENUE</strong> in this plan with weight <strong>100</strong>. Add it from the library or run <strong>Load KSA 2025 preset</strong>.
          </div>
        </div>
      )}

      {kpiUiSection === 'plan-weights' && planKpis.length === 0 && (
        <div className="text-center py-8 text-neutral-500">
          <Target className="w-8 h-8 mx-auto mb-2 text-neutral-300" />
          <p className="mb-2">No KPIs configured for this plan</p>
          <button type="button" onClick={() => { setHelperOpen(true); }} className="text-sm text-violet-600 hover:text-violet-700 font-medium">
            <Wand2 className="w-4 h-4 inline mr-1" /> Open KPI Helper to get started
          </button>
        </div>
      )}

      <div className="pt-4 border-t border-neutral-200 flex items-center gap-3">
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

function SlabsTab({ plan, setPlan, allKpis, allRoles }) {
  const [saving, setSaving] = useState(false);
  const slabSets = plan.slab_sets || [];
  const planKpis = plan.kpis || [];

  const SALES_ROLE_IDS = new Set(['role-salesman', 'role-van-sales', 'role-van-driver', 'role-pre-sales', 'role-ka-exec']);
  const SUPERVISOR_ROLE_IDS = new Set(['role-route-sup', 'role-ss', 'role-asm', 'role-rsm', 'role-depot-mgr']);
  const SALES_SLAB_KPI_CODES = new Set([
    'TOTAL_REVENUE',
    'OVERDUE_PCT',
    'RETURN_PERCENT',
    'PRODUCTIVE_CALLS',
    'SKU_PENETRATION',
    'ROUTE_ADHERENCE',
    'NEW_CUSTOMERS',
    'INV_DELIVERED',
    'IMAGE_VERIFY',
  ]);
  const SUPERVISOR_SLAB_KPI_CODES = new Set([
    'TOTAL_REVENUE',
    'OVERDUE_PCT',
    'RETURN_PERCENT',
    'ROUTE_ADHERENCE',
    'ZERO_SALES_OUTLET',
    'OTD_PERCENT',
    'IMAGE_VERIFY',
  ]);

  const planKpiIdSet = new Set(planKpis.map(k => k.kpi_id));

  const slabKpiOptionsForRole = (roleId, selectedKpiId = '') => {
    let allowedCodeSet = null;
    if (SALES_ROLE_IDS.has(roleId)) allowedCodeSet = SALES_SLAB_KPI_CODES;
    else if (SUPERVISOR_ROLE_IDS.has(roleId)) allowedCodeSet = SUPERVISOR_SLAB_KPI_CODES;

    let options = (allKpis || []).filter(k => planKpiIdSet.has(k.id));
    if (allowedCodeSet) options = options.filter(k => allowedCodeSet.has(k.code));

    // Keep currently selected KPI visible even if role filter changed,
    // so user does not silently lose an existing saved mapping.
    if (selectedKpiId && !options.some(k => k.id === selectedKpiId)) {
      const selected = (allKpis || []).find(k => k.id === selectedKpiId);
      if (selected) options = [selected, ...options];
    }
    return options;
  };

  const addSlabSet = () => {
    setPlan({...plan, slab_sets: [...slabSets, { name: '', type: 'step', kpi_id: '', role_id: '', tiers: [] }]});
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
          <h3 className="font-semibold text-neutral-900">Slab Configuration</h3>
          <p className="text-sm text-neutral-500">Define payout rates at different achievement levels</p>
        </div>
        <button onClick={addSlabSet} className="btn-primary flex items-center gap-1 text-sm">
          <Plus className="w-4 h-4" /> Add Slab Set
        </button>
      </div>

      {slabSets.map((slab, si) => (
        <div key={slab.id || si} className="border border-neutral-200 rounded-lg p-4 space-y-4">
          {(() => {
            const kpiOptions = slabKpiOptionsForRole(slab.role_id || '', slab.kpi_id || '');
            return (
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
            <div className="w-52">
              <label className="label">Role</label>
              <select className="input" value={slab.role_id || ''} onChange={e => updateSet(si, 'role_id', e.target.value)}>
                <option value="">All Roles</option>
                {(allRoles || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {slab.role_name && (
                <div className="text-[11px] text-neutral-400 mt-1">Saved as: {slab.role_name}</div>
              )}
            </div>
            <div className="w-48">
              <label className="label">KPI</label>
              <select className="input" value={slab.kpi_id || ''} onChange={e => updateSet(si, 'kpi_id', e.target.value)}>
                <option value="">Select...</option>
                {kpiOptions.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
              {!!slab.role_id && (
                <div className="text-[11px] text-neutral-400 mt-1">Filtered by role and plan KPIs (KSA PDF scope)</div>
              )}
            </div>
            <button onClick={() => removeSet(si)} className="mt-7 p-1 hover:bg-rose-50 rounded">
              <Trash2 className="w-4 h-4 text-rose-400" />
            </button>
          </div>
            );
          })()}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                <th className="text-left py-2 px-3 font-medium text-neutral-600">Tier</th>
                <th className="text-left py-2 px-3 font-medium text-neutral-600">Min %</th>
                <th className="text-left py-2 px-3 font-medium text-neutral-600">Max %</th>
                <th className="text-left py-2 px-3 font-medium text-neutral-600">Rate</th>
                <th className="text-left py-2 px-3 font-medium text-neutral-600">Rate Type</th>
                <th className="text-left py-2 px-3 font-medium text-neutral-600">Bounds</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {(slab.tiers || []).map((tier, ti) => (
                <tr key={tier.id || ti} className="border-b border-neutral-100">
                  <td className="py-2 px-3 text-neutral-600">{ti + 1}</td>
                  <td className="py-1 px-3"><input type="number" className="input w-20" value={tier.min_percent} onChange={e => updateTier(si, ti, 'min_percent', Number(e.target.value))} /></td>
                  <td className="py-1 px-3"><input type="number" className="input w-20" value={tier.max_percent ?? ''} onChange={e => updateTier(si, ti, 'max_percent', e.target.value === '' ? null : Number(e.target.value))} /></td>
                  <td className="py-1 px-3"><input type="number" className="input w-20" value={tier.rate} onChange={e => updateTier(si, ti, 'rate', Number(e.target.value))} /></td>
                  <td className="py-1 px-3">
                    <select className="input w-44" value={tier.rate_type} onChange={e => updateTier(si, ti, 'rate_type', e.target.value)}>
                      <option value="percentage">Percentage (of Base)</option>
                      <option value="fixed">Fixed Amount</option>
                      <option value="per_unit">Per Unit</option>
                      <option value="per_achievement_point">Per 1% (PDF)</option>
                    </select>
                  </td>
                  <td className="py-1 px-3">
                    <div className="flex items-center gap-2 text-xs text-neutral-600">
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={tier.min_inclusive !== undefined ? !!tier.min_inclusive : true}
                          onChange={e => updateTier(si, ti, 'min_inclusive', e.target.checked ? 1 : 0)}
                        />
                        Min
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={tier.max_inclusive !== undefined ? !!tier.max_inclusive : false}
                          onChange={e => updateTier(si, ti, 'max_inclusive', e.target.checked ? 1 : 0)}
                        />
                        Max
                      </label>
                    </div>
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
        <div className="text-center py-8 text-neutral-500">
          <BarChart3 className="w-8 h-8 mx-auto mb-2 text-neutral-300" />
          <p>No slab configurations</p>
        </div>
      )}

      <div className="pt-4 border-t border-neutral-200">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Slabs'}
        </button>
      </div>
    </div>
  );
}

function MonthlyTargetsTab({ plan, setPlan, allKpis, allRoles }) {
  const [saving, setSaving] = useState(false);
  const rows = plan.monthly_targets || [];

  const addRow = () => {
    const next = [...rows, { period: '', kpi_id: '', role_id: '', target_value: 0 }];
    setPlan({ ...plan, monthly_targets: next });
  };

  const updateRow = (idx, field, value) => {
    const next = [...rows];
    next[idx] = { ...next[idx], [field]: value };
    setPlan({ ...plan, monthly_targets: next });
  };

  const removeRow = (idx) => {
    setPlan({ ...plan, monthly_targets: rows.filter((_, i) => i !== idx) });
  };

  const handleSave = async () => {
    if (!plan.id) return toast.error('Save the General tab first');
    setSaving(true);
    try {
      await api.put(`/plans/${plan.id}/monthly-targets`, { targets: rows });
      toast.success('Monthly targets saved');
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
          <h3 className="font-semibold text-neutral-900">Monthly KPI Targets</h3>
          <p className="text-sm text-neutral-500">Enter month-specific targets used by KPI achievement and PDF deductions</p>
        </div>
        <button onClick={addRow} className="btn-primary flex items-center gap-1 text-sm">
          <Plus className="w-4 h-4" /> Add Target
        </button>
      </div>

      <div className="border border-neutral-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50">
            <tr className="border-b border-neutral-200">
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Period</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Role</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">KPI</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Target</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.id || idx} className="border-b border-neutral-100">
                <td className="py-2 px-3">
                  <input
                    type="month"
                    className="input w-40"
                    value={r.period ? r.period.slice(0, 7) : ''}
                    onChange={e => updateRow(idx, 'period', e.target.value ? `${e.target.value}-01` : '')}
                  />
                </td>
                <td className="py-2 px-3">
                  <select className="input w-52" value={r.role_id || ''} onChange={e => updateRow(idx, 'role_id', e.target.value)}>
                    <option value="">All Roles</option>
                    {(allRoles || []).map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
                  </select>
                </td>
                <td className="py-2 px-3">
                  <select className="input w-64" value={r.kpi_id || ''} onChange={e => updateRow(idx, 'kpi_id', e.target.value)}>
                    <option value="">Select KPI...</option>
                    {(allKpis || []).map(k => <option key={k.id} value={k.id}>{k.name} ({k.code})</option>)}
                  </select>
                </td>
                <td className="py-2 px-3">
                  <input
                    type="number"
                    className="input w-40"
                    value={r.target_value ?? 0}
                    onChange={e => updateRow(idx, 'target_value', Number(e.target.value))}
                  />
                </td>
                <td className="py-2 px-2">
                  <button onClick={() => removeRow(idx)} className="p-1 hover:bg-rose-50 rounded">
                    <Trash2 className="w-4 h-4 text-rose-400" />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm text-neutral-500">
                  No monthly targets. Add targets if your KPIs/deductions depend on monthly target values.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pt-4 border-t border-neutral-200">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Monthly Targets'}
        </button>
      </div>
    </div>
  );
}

function KpiDeductionsTab({ plan, setPlan, allKpis, allRoles }) {
  const [saving, setSaving] = useState(false);
  const [loadingKsaTemplate, setLoadingKsaTemplate] = useState(false);
  const rules = plan.kpi_deduction_rules || [];

  const addRule = () => {
    const next = [...rules, {
      name: '',
      kpi_id: '',
      role_id: '',
      metric_type: 'shortfall_percent',
      min_value: null,
      max_value: null,
      min_inclusive: 1,
      max_inclusive: 1,
      deduction_percent: 0,
      priority: rules.length,
      is_active: 1,
    }];
    setPlan({ ...plan, kpi_deduction_rules: next });
  };

  const updateRule = (idx, field, value) => {
    const next = [...rules];
    next[idx] = { ...next[idx], [field]: value };
    setPlan({ ...plan, kpi_deduction_rules: next });
  };

  const removeRule = (idx) => {
    setPlan({ ...plan, kpi_deduction_rules: rules.filter((_, i) => i !== idx) });
  };

  const handleSave = async () => {
    if (!plan.id) return toast.error('Save the General tab first');
    setSaving(true);
    try {
      await api.put(`/plans/${plan.id}/kpi-deductions`, { rules });
      toast.success('KPI deductions saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLoadKsa2025Template = async () => {
    if (!plan.id) return toast.error('Save the General tab first');
    setLoadingKsaTemplate(true);
    try {
      await api.post(`/plans/${plan.id}/load-ksa-2025`);
      const freshPlan = await api.get(`/plans/${plan.id}`);
      setPlan(freshPlan);
      toast.success('KSA 2025 template loaded');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoadingKsaTemplate(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-neutral-900">KPI Deductions</h3>
          <p className="text-sm text-neutral-500">Apply deduction % to the achieved sales commission when KPI performance is below target</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleLoadKsa2025Template}
            disabled={loadingKsaTemplate}
            className="btn-secondary flex items-center gap-1 text-sm"
          >
            <Sparkles className="w-4 h-4" /> {loadingKsaTemplate ? 'Loading...' : 'Load KSA 2025 Template'}
          </button>
          <button onClick={addRule} className="btn-primary flex items-center gap-1 text-sm">
            <Plus className="w-4 h-4" /> Add Deduction Rule
          </button>
        </div>
      </div>

      <div className="border border-neutral-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50">
            <tr className="border-b border-neutral-200">
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Name</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Role</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">KPI</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Metric</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Min</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Max</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Bounds</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Deduction %</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Priority</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Active</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r, idx) => (
              <tr key={r.id || idx} className="border-b border-neutral-100 align-top">
                <td className="py-2 px-3">
                  <input className="input w-56" value={r.name || ''} onChange={e => updateRule(idx, 'name', e.target.value)} placeholder="e.g., Overdue 7-9%" />
                </td>
                <td className="py-2 px-3">
                  <select className="input w-44" value={r.role_id || ''} onChange={e => updateRule(idx, 'role_id', e.target.value)}>
                    <option value="">All Roles</option>
                    {(allRoles || []).map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
                  </select>
                </td>
                <td className="py-2 px-3">
                  <select className="input w-64" value={r.kpi_id || ''} onChange={e => updateRule(idx, 'kpi_id', e.target.value)}>
                    <option value="">Select KPI...</option>
                    {(allKpis || []).map(k => <option key={k.id} value={k.id}>{k.name} ({k.code})</option>)}
                  </select>
                </td>
                <td className="py-2 px-3">
                  <select className="input w-44" value={r.metric_type || 'shortfall_percent'} onChange={e => updateRule(idx, 'metric_type', e.target.value)}>
                    <option value="shortfall_percent">Shortfall % (100 - achievement)</option>
                    <option value="achievement_percent">Achievement %</option>
                    <option value="actual_value">Actual Value</option>
                  </select>
                </td>
                <td className="py-2 px-3">
                  <input
                    type="number"
                    className="input w-28"
                    value={r.min_value ?? ''}
                    onChange={e => updateRule(idx, 'min_value', e.target.value === '' ? null : Number(e.target.value))}
                  />
                </td>
                <td className="py-2 px-3">
                  <input
                    type="number"
                    className="input w-28"
                    value={r.max_value ?? ''}
                    onChange={e => updateRule(idx, 'max_value', e.target.value === '' ? null : Number(e.target.value))}
                  />
                </td>
                <td className="py-2 px-3">
                  <div className="flex items-center gap-2 text-xs text-neutral-600">
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={r.min_inclusive === undefined ? true : !!r.min_inclusive}
                        onChange={e => updateRule(idx, 'min_inclusive', e.target.checked ? 1 : 0)}
                      />
                      Min
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={r.max_inclusive === undefined ? true : !!r.max_inclusive}
                        onChange={e => updateRule(idx, 'max_inclusive', e.target.checked ? 1 : 0)}
                      />
                      Max
                    </label>
                  </div>
                </td>
                <td className="py-2 px-3">
                  <input type="number" className="input w-28" value={r.deduction_percent ?? 0} onChange={e => updateRule(idx, 'deduction_percent', Number(e.target.value))} />
                </td>
                <td className="py-2 px-3">
                  <input type="number" className="input w-24" value={r.priority ?? idx} onChange={e => updateRule(idx, 'priority', Number(e.target.value))} />
                </td>
                <td className="py-2 px-3">
                  <input type="checkbox" checked={r.is_active === undefined ? true : !!r.is_active} onChange={e => updateRule(idx, 'is_active', e.target.checked ? 1 : 0)} />
                </td>
                <td className="py-2 px-2">
                  <button onClick={() => removeRule(idx)} className="p-1 hover:bg-rose-50 rounded">
                    <Trash2 className="w-4 h-4 text-rose-400" />
                  </button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr>
                <td colSpan={11} className="py-10 text-center text-sm text-neutral-500">
                  No KPI deductions configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pt-4 border-t border-neutral-200">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save KPI Deductions'}
        </button>
      </div>
    </div>
  );
}

function FixedIncentivesTab({ plan, setPlan, allKpis, allRoles }) {
  const [saving, setSaving] = useState(false);
  const rows = plan.fixed_incentives || [];

  const addRow = () => {
    const next = [...rows, {
      period: '',
      role_id: '',
      name: '',
      amount: 0,
      condition_kpi_id: '',
      condition_operator: '>=',
      condition_value: null,
      is_active: 1,
    }];
    setPlan({ ...plan, fixed_incentives: next });
  };

  const updateRow = (idx, field, value) => {
    const next = [...rows];
    next[idx] = { ...next[idx], [field]: value };
    setPlan({ ...plan, fixed_incentives: next });
  };

  const removeRow = (idx) => setPlan({ ...plan, fixed_incentives: rows.filter((_, i) => i !== idx) });

  const handleSave = async () => {
    if (!plan.id) return toast.error('Save the General tab first');
    setSaving(true);
    try {
      await api.put(`/plans/${plan.id}/fixed-incentives`, { incentives: rows });
      toast.success('Fixed incentives saved');
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
          <h3 className="font-semibold text-neutral-900">Fixed Incentives</h3>
          <p className="text-sm text-neutral-500">Optional fixed payments for selected months based on KPI conditions</p>
        </div>
        <button onClick={addRow} className="btn-primary flex items-center gap-1 text-sm">
          <Plus className="w-4 h-4" /> Add Incentive
        </button>
      </div>

      <div className="border border-neutral-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50">
            <tr className="border-b border-neutral-200">
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Period</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Role</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Name</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Amount</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Condition KPI</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Op</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Value</th>
              <th className="text-left py-2 px-3 font-medium text-neutral-600">Active</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.id || idx} className="border-b border-neutral-100">
                <td className="py-2 px-3">
                  <input
                    type="month"
                    className="input w-40"
                    value={r.period ? r.period.slice(0, 7) : ''}
                    onChange={e => updateRow(idx, 'period', e.target.value ? `${e.target.value}-01` : '')}
                  />
                </td>
                <td className="py-2 px-3">
                  <select className="input w-44" value={r.role_id || ''} onChange={e => updateRow(idx, 'role_id', e.target.value)}>
                    <option value="">All Roles</option>
                    {(allRoles || []).map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
                  </select>
                </td>
                <td className="py-2 px-3">
                  <input className="input w-64" value={r.name || ''} onChange={e => updateRow(idx, 'name', e.target.value)} placeholder="e.g., Ramadan incentive" />
                </td>
                <td className="py-2 px-3">
                  <input type="number" className="input w-32" value={r.amount ?? 0} onChange={e => updateRow(idx, 'amount', Number(e.target.value))} />
                </td>
                <td className="py-2 px-3">
                  <select className="input w-64" value={r.condition_kpi_id || ''} onChange={e => updateRow(idx, 'condition_kpi_id', e.target.value)}>
                    <option value="">No condition</option>
                    {(allKpis || []).map(k => <option key={k.id} value={k.id}>{k.name} ({k.code})</option>)}
                  </select>
                </td>
                <td className="py-2 px-3">
                  <select className="input w-24" value={r.condition_operator || '>='} onChange={e => updateRow(idx, 'condition_operator', e.target.value)}>
                    <option value=">=">{'>='}</option>
                    <option value=">">{'>'}</option>
                    <option value="<=">{'<='}</option>
                    <option value="<">{'<'}</option>
                    <option value="=">{'='}</option>
                  </select>
                </td>
                <td className="py-2 px-3">
                  <input
                    type="number"
                    className="input w-32"
                    value={r.condition_value ?? ''}
                    onChange={e => updateRow(idx, 'condition_value', e.target.value === '' ? null : Number(e.target.value))}
                    disabled={!r.condition_kpi_id}
                  />
                </td>
                <td className="py-2 px-3">
                  <input type="checkbox" checked={r.is_active === undefined ? true : !!r.is_active} onChange={e => updateRow(idx, 'is_active', e.target.checked ? 1 : 0)} />
                </td>
                <td className="py-2 px-2">
                  <button onClick={() => removeRow(idx)} className="p-1 hover:bg-rose-50 rounded">
                    <Trash2 className="w-4 h-4 text-rose-400" />
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-10 text-center text-sm text-neutral-500">
                  No fixed incentives configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pt-4 border-t border-neutral-200">
        <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Fixed Incentives'}
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
    <div className="border border-neutral-200 rounded-lg p-3 bg-white">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-neutral-700">{title}</span>
        <span className="text-xs text-neutral-400">{selected.length} selected</span>
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
        <div className="text-xs text-neutral-400 py-2">Loading...</div>
      ) : (
        <div className={cn("space-y-1 overflow-y-auto", filtered.length > 8 ? "max-h-48" : "")}>
          {filtered.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-neutral-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => onToggle(opt.value)}
                className="rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-neutral-700 truncate">{opt.label}</span>
            </label>
          ))}
          {filtered.length === 0 && !isLoading && (
            <div className="text-xs text-neutral-400 py-2">
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
        <h3 className="font-semibold text-neutral-900">Product & Customer Scope</h3>
        <p className="text-sm text-neutral-500">Define which products and customers this commission plan applies to</p>
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
        <h4 className="font-medium text-neutral-800 flex items-center gap-2">
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
              <span className="text-sm text-neutral-700">
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
              <button onClick={() => setShowProductExclude(true)} className="text-xs text-neutral-500 hover:text-neutral-700 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add product exclusions
              </button>
            ) : (
              <div className="border-t border-neutral-100 pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-rose-600 uppercase">Exclude</span>
                  <button onClick={() => { setShowProductExclude(false); setExcludedProductCats([]); setExcludedProducts([]); }}
                    className="text-xs text-neutral-400 hover:text-neutral-600">Clear exclusions</button>
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
        <h4 className="font-medium text-neutral-800 flex items-center gap-2">
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
              <span className="text-sm text-neutral-700">
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
              <button onClick={() => setShowCustomerExclude(true)} className="text-xs text-neutral-500 hover:text-neutral-700 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Add customer exclusions
              </button>
            ) : (
              <div className="border-t border-neutral-100 pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-rose-600 uppercase">Exclude</span>
                  <button onClick={() => { setShowCustomerExclude(false); setExcludedChannels([]); setExcludedGroups([]); setExcludedCustomers([]); }}
                    className="text-xs text-neutral-400 hover:text-neutral-600">Clear exclusions</button>
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

      <div className="pt-4 border-t border-neutral-200">
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
          <h3 className="font-semibold text-neutral-900">Eligibility Rules</h3>
          <p className="text-sm text-neutral-500">Minimum criteria employees must meet to receive payouts</p>
        </div>
        <button onClick={addRule} className="btn-primary flex items-center gap-1 text-sm">
          <Plus className="w-4 h-4" /> Add Rule
        </button>
      </div>

      <div className="space-y-3">
        {rules.map((rule, i) => (
          <div key={rule.id || i} className="flex items-center gap-3 py-3 px-4 border border-neutral-200 rounded-lg">
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
        <div className="text-center py-8 text-neutral-500">
          <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-neutral-300" />
          <p>No eligibility rules configured</p>
        </div>
      )}

      <div className="pt-4 border-t border-neutral-200">
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
          <h3 className="font-semibold text-neutral-900">Multiplier Rules</h3>
          <p className="text-sm text-neutral-500">Bonus multipliers for exceeding specific conditions</p>
        </div>
        <button onClick={addRule} className="btn-primary flex items-center gap-1 text-sm">
          <Plus className="w-4 h-4" /> Add Multiplier
        </button>
      </div>

      <div className="space-y-3">
        {rules.map((rule, i) => (
          <div key={rule.id || i} className="border border-neutral-200 rounded-lg p-4 space-y-3">
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
        <div className="text-center py-8 text-neutral-500">
          <Zap className="w-8 h-8 mx-auto mb-2 text-neutral-300" />
          <p>No multiplier rules configured</p>
        </div>
      )}

      <div className="pt-4 border-t border-neutral-200">
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
          <h3 className="font-semibold text-neutral-900">Penalty Rules</h3>
          <p className="text-sm text-neutral-500">Deductions triggered when thresholds are exceeded</p>
        </div>
        <button onClick={addRule} className="btn-primary flex items-center gap-1 text-sm">
          <Plus className="w-4 h-4" /> Add Penalty
        </button>
      </div>

      <div className="space-y-3">
        {rules.map((rule, i) => (
          <div key={rule.id || i} className="flex items-center gap-3 py-3 px-4 border border-neutral-200 rounded-lg">
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
        <div className="text-center py-8 text-neutral-500">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-neutral-300" />
          <p>No penalty rules configured</p>
        </div>
      )}

      <div className="pt-4 border-t border-neutral-200">
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
            <h3 className="font-semibold text-neutral-900">Capping Rules</h3>
            <p className="text-sm text-neutral-500">Maximum payout limits (most restrictive wins)</p>
          </div>
          <button onClick={addCap} className="btn-primary flex items-center gap-1 text-sm">
            <Plus className="w-4 h-4" /> Add Cap
          </button>
        </div>

        <div className="space-y-3">
          {caps.map((cap, i) => (
            <div key={cap.id || i} className="flex items-center gap-4 py-3 px-4 border border-neutral-200 rounded-lg">
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
            <h3 className="font-semibold text-neutral-900">Split Rules</h3>
            <p className="text-sm text-neutral-500">Commission split between roles</p>
          </div>
          <button onClick={addSplit} className="btn-primary flex items-center gap-1 text-sm">
            <Plus className="w-4 h-4" /> Add Split
          </button>
        </div>

        <div className="space-y-3">
          {splits.map((split, si) => (
            <div key={split.id || si} className="border border-neutral-200 rounded-lg p-4 space-y-3">
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
                    <span className="text-sm text-neutral-400">%</span>
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
          <div className="text-center py-8 text-neutral-500">
            <Scissors className="w-8 h-8 mx-auto mb-2 text-neutral-300" />
            <p>No caps or splits configured</p>
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-neutral-200">
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

  if (loading) return <div className="h-64 bg-neutral-100 animate-pulse rounded" />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-neutral-900 flex items-center gap-2">
            <Truck className="w-5 h-5 text-primary-600" />
            Helper Commission
          </h3>
          <p className="text-sm text-neutral-500">
            Pay helpers per case delivered. Rate depends on team size (fewer helpers = higher per-person rate per case).
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
            <h4 className="font-semibold text-neutral-900">Rate Table by Team Size</h4>
            <p className="text-sm text-neutral-600">
              Define how much each helper earns per case based on how many people share the delivery.
              <span className="block mt-1 text-xs text-neutral-500">
                Example: 1 helper solo = 12 AED · 2 helpers sharing = 7 AED each · 3 helpers = 5 AED each (per case)
              </span>
            </p>
          </div>
          <button onClick={applyDefaults} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-neutral-200 hover:bg-neutral-50 whitespace-nowrap">
            Apply Defaults
          </button>
        </div>

        <div className="overflow-x-auto bg-white rounded-lg border border-neutral-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50">
                <th className="text-left py-2.5 px-4 font-medium text-neutral-600">Team Size</th>
                <th className="text-right py-2.5 px-4 font-medium text-neutral-600">Rate Per Person (AED/case)</th>
                <th className="text-center py-2.5 px-4 font-medium text-neutral-600 hidden md:table-cell">Example</th>
                <th className="text-center py-2.5 px-4 font-medium text-neutral-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r, i) => (
                <tr key={i} className="border-b border-neutral-100">
                  <td className="py-2 px-4">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        className="input w-20"
                        value={r.team_size}
                        onChange={e => updateRate(i, 'team_size', Number(e.target.value))}
                      />
                      <Users className="w-4 h-4 text-neutral-400" />
                      <span className="text-xs text-neutral-500">
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
                  <td className="py-2 px-4 text-center text-xs text-neutral-500 hidden md:table-cell">
                    Each helper earns <strong className="text-neutral-700">{r.rate_per_person} AED</strong> per case
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
                  <td colSpan="4" className="text-center py-6 text-neutral-400">
                    No rate tiers configured. Click "Apply Defaults" or "Add Tier".
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={addRate} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-neutral-200 hover:bg-neutral-50">
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
            <h4 className="font-semibold text-neutral-900">Case Log</h4>
            <p className="text-xs text-neutral-500">
              {showAllPeriods
                ? `${trips.length} cases total (all periods)`
                : `${visibleTrips.length} cases in ${tripFilterPeriod} · ${trips.length} total`
              }
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              className="text-xs md:text-sm border border-neutral-300 rounded-lg px-2 py-1.5 bg-white font-medium min-w-[150px]"
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
              <optgroup label="Periods with cases">
                {availablePeriods.map(p => {
                  const count = trips.filter(t => t.period === p).length;
                  return (
                    <option key={p} value={p}>
                      {p} ({count} {count === 1 ? 'case' : 'cases'})
                    </option>
                  );
                })}
              </optgroup>
            </select>
            <input
              type="month"
              className="text-xs md:text-sm border border-neutral-300 rounded-lg px-2 py-1.5 bg-white"
              value={tripFilterPeriod}
              title="Pick any month"
              onChange={e => {
                setShowAllPeriods(false);
                setTripFilterPeriod(e.target.value);
              }}
            />
            <button onClick={() => setShowNewTrip(!showNewTrip)} className="btn-primary flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Log New Case
            </button>
          </div>
        </div>

        {/* New trip form */}
        {showNewTrip && (
          <div className="p-4 rounded-lg bg-neutral-50 border border-neutral-200 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <div>
                <label className="label">Case Number</label>
                <input className="input" value={newTrip.trip_number} onChange={e => setNewTrip({...newTrip, trip_number: e.target.value})} placeholder="CASE-001" />
              </div>
              <div>
                <label className="label">Start Date</label>
                <input type="date" className="input" value={newTrip.trip_date} onChange={e => setNewTrip({...newTrip, trip_date: e.target.value, period: e.target.value.slice(0, 7)})} />
              </div>
              <div>
                <label className="label">End Date <span className="text-neutral-400 text-xs">(optional)</span></label>
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
                        : 'bg-white text-neutral-600 border-neutral-200 hover:border-primary-300'
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
                      <span className="text-neutral-400">·</span>
                      <span>
                        <strong>{days}</strong> case{days !== 1 ? 's' : ''}
                      </span>
                      <span className="text-neutral-400">·</span>
                      <span>
                        Rate per person per case: <strong>{rate} AED</strong>
                      </span>
                      {size > 0 && (
                        <>
                          <span className="text-neutral-400">=</span>
                          <span className="text-emerald-600 font-semibold">
                            {perPerson} AED each
                          </span>
                          <span className="text-neutral-400 text-xs">
                            ({rate} × {days} case{days !== 1 ? 's' : ''})
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="flex gap-2">
              <button onClick={createTrip} className="btn-primary">Create Case</button>
              <button onClick={() => setShowNewTrip(false)} className="px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100 rounded-lg">Cancel</button>
            </div>
          </div>
        )}

        {/* Trips table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                <th className="text-left py-2 px-3 font-medium text-neutral-600">Case #</th>
                <th className="text-left py-2 px-3 font-medium text-neutral-600">Dates</th>
                <th className="text-center py-2 px-3 font-medium text-neutral-600">Days</th>
                <th className="text-left py-2 px-3 font-medium text-neutral-600">Team</th>
                <th className="text-left py-2 px-3 font-medium text-neutral-600 hidden md:table-cell">Participants</th>
                <th className="text-right py-2 px-3 font-medium text-neutral-600">Per Person</th>
              </tr>
            </thead>
            <tbody>
              {visibleTrips.length === 0 && (
                <tr>
                  <td colSpan="6" className="py-8 text-center text-neutral-400 text-sm">
                    No cases found for <strong>{tripFilterPeriod}</strong>.
                    {' '}
                    <button onClick={() => setShowAllPeriods(true)} className="underline text-primary-600">Show all periods</button>
                    {' '}or{' '}
                    <button onClick={() => setShowNewTrip(true)} className="underline text-primary-600">log a new case</button>.
                  </td>
                </tr>
              )}
              {visibleTrips.slice(0, 50).map(t => {
                const days = t.days_count || computeDaysLocal(t.trip_date, t.trip_end_date);
                const rate = computeRateForSize(t.team_size);
                const total = rate * days;
                return (
                  <tr key={t.id} className="border-b border-neutral-100 hover:bg-neutral-50">
                    <td className="py-2 px-3 font-mono text-xs">{t.trip_number}</td>
                    <td className="py-2 px-3 text-neutral-500 text-xs">
                      {t.trip_date}
                      {t.trip_end_date && t.trip_end_date !== t.trip_date && <span className="text-neutral-400"> → {t.trip_end_date}</span>}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span className={cn('badge', days > 1 ? 'badge-info' : 'badge-gray')}>{days} case{days !== 1 ? 's' : ''}</span>
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
                      {days > 1 && <div className="text-[10px] text-neutral-400">{rate} × {days} cases</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visibleTrips.length > 50 && (
          <p className="text-xs text-neutral-400 text-center">Showing first 50 of {visibleTrips.length} cases</p>
        )}
      </div>

      {/* Commission Preview */}
      <div className="card p-5 bg-gradient-to-br from-emerald-50/50 via-white to-teal-50/50 border-emerald-100">
        <h4 className="font-semibold text-neutral-900 mb-2">Commission Preview</h4>
        <p className="text-xs text-neutral-500 mb-3">
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
            <span>No cases found for this employee in <strong>{previewPeriod}</strong>. Try another period — the case you just logged may be in a different month.</span>
          </div>
        )}

        {preview && (
          <div className="mt-4 p-4 rounded-lg bg-white border border-emerald-200 space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
              <div>
                <div className="text-xs text-neutral-500">Total Cases</div>
                <div className="text-xl font-bold text-neutral-900">{preview.total_trips}</div>
              </div>
              <div>
                <div className="text-xs text-neutral-500">Total Cases</div>
                <div className="text-xl font-bold text-primary-600">{preview.total_days || 0}</div>
              </div>
              <div>
                <div className="text-xs text-neutral-500">Solo</div>
                <div className="text-xl font-bold text-emerald-600">{preview.solo_trips}</div>
              </div>
              <div>
                <div className="text-xs text-neutral-500">Paired</div>
                <div className="text-xl font-bold text-sky-600">{preview.paired_trips}</div>
              </div>
              <div>
                <div className="text-xs text-neutral-500">Team (3+)</div>
                <div className="text-xl font-bold text-amber-600">{preview.team_trips}</div>
              </div>
            </div>

            {/* Per-trip breakdown */}
            {preview.breakdown && preview.breakdown.length > 0 && (
              <div className="overflow-x-auto border-t border-neutral-100 pt-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-neutral-500">
                      <th className="text-left py-1.5 px-2">Case</th>
                      <th className="text-left py-1.5 px-2">Dates</th>
                      <th className="text-center py-1.5 px-2">Cases</th>
                      <th className="text-center py-1.5 px-2">Team</th>
                      <th className="text-right py-1.5 px-2">Rate/case</th>
                      <th className="text-right py-1.5 px-2">Earned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.breakdown.map(b => (
                      <tr key={b.id} className="border-t border-neutral-50">
                        <td className="py-1.5 px-2 font-mono text-[10px]">{b.trip_number}</td>
                        <td className="py-1.5 px-2 text-neutral-500">
                          {b.trip_date}
                          {b.trip_end_date && b.trip_end_date !== b.trip_date && <span className="text-neutral-400"> → {b.trip_end_date}</span>}
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

            <div className="pt-2 border-t border-neutral-100 flex items-center justify-between">
              <span className="text-sm font-medium text-neutral-600">Total Helper Commission:</span>
              <span className="text-2xl font-bold text-emerald-600">{preview.total_commission} AED</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

