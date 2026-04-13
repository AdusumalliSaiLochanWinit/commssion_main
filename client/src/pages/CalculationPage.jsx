import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAppStore } from '../store/store';
import toast from 'react-hot-toast';
import {
  Calculator, Play, CheckCircle2, XCircle, Clock, ChevronDown, ChevronRight,
  Loader2, ArrowRight, TrendingUp, AlertTriangle, Shield, Sparkles, Download, Info, AlertCircle
} from 'lucide-react';
import { formatCurrency, formatPercent, formatDateTime, cn, getStatusColor, getStatusLabel } from '../lib/utils';

const PIPELINE_STEPS = [
  { step: 1, name: 'Fetch Transactions', desc: 'Loading scoped transaction data',
    info: 'Pulls all transactions for the employee in the selected period, joined with product and customer data.' },
  { step: 2, name: 'Apply Filters', desc: 'Include/exclude mapping rules',
    info: 'Applies include/exclude rules (product categories, customer channels) to filter out non-commissionable transactions.' },
  { step: 2.5, name: 'Eligibility Check', desc: 'Verify minimum criteria',
    info: 'Checks if the employee meets minimum thresholds (e.g., min sales, min collection %). Can zero out or reduce payout.' },
  { step: 3, name: 'KPI Achievement', desc: 'Calculate actual vs target',
    info: 'For each KPI in the plan, computes the actual value using the formula and calculates achievement % against target.' },
  { step: 4, name: 'Determine Slab', desc: 'Match achievement to slab tier',
    info: 'Maps the achievement % to a slab tier (step, progressive, or accelerator) to determine the commission rate.' },
  { step: 5, name: 'KPI Payout', desc: 'Calculate raw payout per KPI',
    info: 'Multiplies the slab rate by the base payout or actual value to compute raw commission for each KPI.' },
  { step: 6, name: 'Apply Weight', desc: 'Weight-adjusted payout',
    info: 'Multiplies each KPI payout by its weight percentage (e.g., 40% for revenue, 20% for units).' },
  { step: 7, name: 'Aggregate KPIs', desc: 'Sum to gross payout',
    info: 'Sums all weighted KPI payouts into a single gross payout figure for the employee.' },
  { step: 8, name: 'Apply Multiplier', desc: 'Growth/strategic bonuses',
    info: 'Applies bonus multipliers (e.g., +15% for revenue growth, +10% for strategic SKU push) if conditions are met.' },
  { step: 9, name: 'Apply Penalty', desc: 'Deductions for violations',
    info: 'Deducts penalties (e.g., -15% for high return rate above threshold) from the payout.' },
  { step: 10, name: 'Apply Cap', desc: 'Enforce payout limits',
    info: 'Caps the payout at configured limits (e.g., max AED 50,000 per plan or 150% of salary).' },
  { step: 11, name: 'Store Payout', desc: 'Persist results to database',
    info: 'Saves the final payout record and per-KPI results to the database for audit trail.' },
  { step: 12, name: 'Create Approval', desc: 'Submit for approval workflow',
    info: 'Creates an approval entry so the payout can go through the manager/finance/HR approval chain.' },
  { step: 13, name: 'Complete', desc: 'Finalize calculation run',
    info: 'Marks the calculation run as completed and tallies total payout across all employees.' },
];

export default function CalculationPage() {
  const { selectedPeriod } = useAppStore();
  const [plans, setPlans] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [running, setRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [result, setResult] = useState(null);
  const [pastRuns, setPastRuns] = useState([]);
  const [expandedPayout, setExpandedPayout] = useState(null);
  const [payoutDetail, setPayoutDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hoveredStep, setHoveredStep] = useState(null);

  const [totalPlanCount, setTotalPlanCount] = useState(0);
  useEffect(() => {
    Promise.all([api.get('/plans'), api.get('/calculation/runs'), api.get('/employees')])
      .then(([p, r, e]) => {
        const active = p.filter(pl => pl.status === 'active');
        setPlans(active);
        setTotalPlanCount(p.length);
        setPastRuns(r);
        setEmployees(e);
        if (active.length > 0) setSelectedPlan(active[0].id);
      })
      .finally(() => setLoading(false));
  }, []);

  const runCalculation = async () => {
    if (!selectedPlan) return toast.error('Select a plan first');
    setRunning(true);
    setResult(null);
    setExpandedPayout(null);
    setPayoutDetail(null);
    setCurrentStep(0);

    // Animate steps
    const stepAnimation = setInterval(() => {
      setCurrentStep(prev => {
        if (prev >= PIPELINE_STEPS.length - 1) {
          clearInterval(stepAnimation);
          return prev;
        }
        return prev + 1;
      });
    }, 300);

    try {
      const body = {
        plan_id: selectedPlan,
        period: selectedPeriod,
        created_by: 'admin',
      };
      if (selectedEmployee) body.employee_id = selectedEmployee;

      const res = await api.post('/calculation/run', body);

      clearInterval(stepAnimation);
      setCurrentStep(PIPELINE_STEPS.length - 1);
      setResult(res);
      toast.success(`Calculation complete! ${res.employee_count} employees processed`);

      // Refresh past runs
      const runs = await api.get('/calculation/runs');
      setPastRuns(runs);
    } catch (err) {
      clearInterval(stepAnimation);
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  const loadPayoutDetail = async (payoutId) => {
    if (expandedPayout === payoutId) {
      setExpandedPayout(null);
      setPayoutDetail(null);
      return;
    }
    try {
      const detail = await api.get(`/calculation/payouts/${payoutId}`);
      setPayoutDetail(detail);
      setExpandedPayout(payoutId);
    } catch (err) {
      toast.error('Failed to load payout details');
    }
  };

  const togglePayoutExpand = async (p) => {
    if (!result?.run_id) return;
    // If already expanded for this employee, collapse
    if (payoutDetail && payoutDetail.employee_id === p.employee_id) {
      setExpandedPayout(null);
      setPayoutDetail(null);
      return;
    }
    try {
      const run = await api.get(`/calculation/runs/${result.run_id}`);
      const payout = run.payouts?.find(ep => ep.employee_id === p.employee_id);
      if (payout) {
        const detail = await api.get(`/calculation/payouts/${payout.id}`);
        setPayoutDetail(detail);
        setExpandedPayout(payout.id);
      }
    } catch (err) {
      toast.error('Failed to load payout details');
    }
  };

  const loadRunDetail = async (runId) => {
    try {
      const run = await api.get(`/calculation/runs/${runId}`);
      setResult(run);
      setExpandedPayout(null);
      setPayoutDetail(null);
      setCurrentStep(PIPELINE_STEPS.length - 1);
    } catch (err) {
      toast.error('Failed to load run details');
    }
  };

  if (loading) {
    return <div className="h-96 bg-slate-100 rounded-xl animate-pulse" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-slate-900">Calculate Commission</h1>
        <p className="text-sm text-slate-500 mt-1">Run the 13-step calculation pipeline</p>
      </div>

      {/* Draft plans notice */}
      {plans.length === 0 && totalPlanCount > 0 && (
        <div className="card p-4 bg-amber-50 border-amber-200 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-medium text-amber-900">No active plans to calculate</div>
            <div className="text-sm text-amber-800 mt-0.5">
              You have <strong>{totalPlanCount}</strong> plan{totalPlanCount > 1 ? 's' : ''} but all are in <strong>draft</strong>.
              Open a plan from the <button onClick={() => window.location.href='/plans'} className="underline font-medium">Plans page</button> and click <strong>"Activate Plan"</strong> to use it here.
            </div>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="card p-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4 flex-wrap">
          <div className="flex-1 min-w-0 sm:min-w-[200px] sm:max-w-xs">
            <label className="label">Commission Plan</label>
            <select className="input" value={selectedPlan} onChange={e => setSelectedPlan(e.target.value)}>
              {plans.length === 0 && <option value="">No active plans</option>}
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-0 sm:min-w-[200px] sm:max-w-xs">
            <label className="label">Employee</label>
            <select className="input" value={selectedEmployee} onChange={e => setSelectedEmployee(e.target.value)}>
              <option value="">All Employees</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Period</label>
            <div className="input bg-slate-50 text-slate-600">{selectedPeriod}</div>
          </div>
          <button
            onClick={runCalculation}
            disabled={running || !selectedPlan}
            className="btn-primary flex items-center gap-2 h-[42px]"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {running ? 'Running...' : 'Run Calculation'}
          </button>
        </div>
      </div>

      {/* Pipeline Visualizer */}
      {currentStep >= 0 && (
        <div className="card p-5">
          <h3 className="font-semibold text-slate-900 mb-4">Pipeline Progress</h3>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1">
            {PIPELINE_STEPS.map((step, i) => {
              const isComplete = i <= currentStep;
              const isCurrent = i === currentStep && running;
              return (
                <div key={step.step} className="text-center relative group">
                  <div className="relative inline-block">
                    <div className={cn(
                      'w-8 h-8 rounded-full mx-auto flex items-center justify-center text-xs font-bold transition-all duration-300',
                      isComplete ? 'bg-emerald-500 text-white scale-100' :
                      isCurrent ? 'bg-primary-500 text-white animate-pulse scale-110' :
                      'bg-slate-200 text-slate-400'
                    )}>
                      {isComplete && !isCurrent ? <CheckCircle2 className="w-4 h-4" /> :
                       isCurrent ? <Loader2 className="w-4 h-4 animate-spin" /> :
                       Math.floor(step.step)}
                    </div>
                    {/* Info icon */}
                    <div
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-white rounded-full flex items-center justify-center border border-slate-200 cursor-help opacity-0 group-hover:opacity-100 transition-opacity"
                      onMouseEnter={() => setHoveredStep(i)}
                      onMouseLeave={() => setHoveredStep(null)}
                    >
                      <Info className="w-2.5 h-2.5 text-slate-400" />
                    </div>
                  </div>
                  <div className={cn(
                    'text-[10px] mt-1 leading-tight',
                    isComplete ? 'text-slate-700 font-medium' : 'text-slate-400'
                  )}>
                    {step.name}
                  </div>
                  {/* Tooltip */}
                  {hoveredStep === i && (
                    <div className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2.5 bg-slate-800 text-white text-xs rounded-lg shadow-lg text-left leading-relaxed pointer-events-none">
                      <div className="font-semibold mb-1">{step.name}</div>
                      <div className="text-slate-300">{step.info}</div>
                      <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                        <div className="border-4 border-transparent border-t-slate-800" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Progress bar */}
          <div className="mt-4 h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary-500 to-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${((currentStep + 1) / PIPELINE_STEPS.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Results */}
      {result && result.payouts && (
        <div className="card">
          <div className="p-5 border-b border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">Calculation Results</h3>
                <p className="text-sm text-slate-500">{result.employee_count} employees • Run ID: {result.run_id?.slice(0, 8)}</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-slate-900">{formatCurrency(result.total_payout)}</div>
                <div className="text-sm text-slate-500">Total Payout</div>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left py-3 px-5 font-medium text-slate-600">Employee</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600">Role</th>
                  <th className="text-right py-3 px-4 font-medium text-slate-600">Gross</th>
                  <th className="text-right py-3 px-4 font-medium text-slate-600">Net Payout</th>
                  <th className="text-center py-3 px-4 font-medium text-slate-600">Eligibility</th>
                  <th className="text-center py-3 px-4 font-medium text-slate-600">Details</th>
                </tr>
              </thead>
              <tbody>
                {result.payouts.map(p => {
                  const isExpanded = payoutDetail && payoutDetail.employee_id === p.employee_id;
                  return (
                    <>{/* eslint-disable-next-line react/jsx-key */}
                      <tr key={p.employee_id} className={cn('border-b border-slate-100 hover:bg-slate-50 cursor-pointer', isExpanded && 'bg-primary-50')} onClick={() => togglePayoutExpand(p)}>
                        <td className="py-3 px-5">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-semibold">
                              {p.employee_name.split(' ').map(n => n[0]).join('')}
                            </div>
                            <span className="font-medium text-slate-900">{p.employee_name}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-600">{p.role_name}</td>
                        <td className="py-3 px-4 text-right text-slate-600">{formatCurrency(p.gross_payout)}</td>
                        <td className="py-3 px-4 text-right font-semibold text-slate-900">{formatCurrency(p.net_payout)}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={cn('badge', {
                            'badge-success': p.eligibility_status === 'eligible',
                            'badge-warning': p.eligibility_status === 'reduced',
                            'badge-danger': p.eligibility_status === 'ineligible',
                          })}>
                            {p.eligibility_status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-primary-500 mx-auto" /> : <ChevronRight className="w-4 h-4 text-slate-400 mx-auto" />}
                        </td>
                      </tr>

                      {/* KPI Breakdown Expansion */}
                      {isExpanded && payoutDetail && (
                        <tr key={`${p.employee_id}-detail`}>
                          <td colSpan={6} className="p-0">
                            <div className="bg-slate-50 border-b border-slate-200">
                              {/* Summary cards */}
                              {(() => {
                                const details = typeof payoutDetail.calculation_details === 'string'
                                  ? (() => { try { return JSON.parse(payoutDetail.calculation_details); } catch { return {}; } })()
                                  : (payoutDetail.calculation_details || {});
                                const helperBonus = details.helper_trip_bonus || 0;
                                const helperTrips = details.helper_trips;
                                return (
                                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 p-4 pb-2">
                                    <div className="bg-white rounded-lg p-3 border border-slate-200">
                                      <div className="text-xs text-slate-400 mb-1">Gross Payout</div>
                                      <div className="text-sm font-bold text-slate-900">{formatCurrency(payoutDetail.gross_payout)}</div>
                                    </div>
                                    {helperBonus > 0 && (
                                      <div className="bg-white rounded-lg p-3 border-2 border-sky-200">
                                        <div className="text-xs text-sky-600 mb-1 font-medium flex items-center gap-1">
                                          🚚 Helper Trip Bonus
                                        </div>
                                        <div className="text-sm font-bold text-sky-700">+{formatCurrency(helperBonus)}</div>
                                        {helperTrips && (
                                          <div className="text-[10px] text-slate-500 mt-0.5">
                                            {helperTrips.trip_count} trips · {helperTrips.total_days} days
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    <div className="bg-white rounded-lg p-3 border border-slate-200">
                                      <div className="text-xs text-slate-400 mb-1">Multiplier Bonus</div>
                                      <div className="text-sm font-bold text-emerald-600">+{formatCurrency(payoutDetail.multiplier_amount)}</div>
                                    </div>
                                    <div className="bg-white rounded-lg p-3 border border-slate-200">
                                      <div className="text-xs text-slate-400 mb-1">Penalty</div>
                                      <div className="text-sm font-bold text-rose-600">-{formatCurrency(payoutDetail.penalty_amount)}</div>
                                    </div>
                                    <div className="bg-white rounded-lg p-3 border border-slate-200">
                                      <div className="text-xs text-slate-400 mb-1">Net Payout</div>
                                      <div className="text-sm font-bold text-primary-700">{formatCurrency(payoutDetail.net_payout)}</div>
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* KPI Results Table */}
                              {payoutDetail.kpi_results && payoutDetail.kpi_results.length > 0 && (
                                <div className="px-4 pb-4">
                                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 mt-1">KPI Breakdown</div>
                                  <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="bg-slate-100 border-b border-slate-200">
                                          <th className="text-left py-2 px-3 font-medium text-slate-500">KPI</th>
                                          <th className="text-left py-2 px-3 font-medium text-slate-500">Category</th>
                                          <th className="text-right py-2 px-3 font-medium text-slate-500">Target</th>
                                          <th className="text-right py-2 px-3 font-medium text-slate-500">Actual</th>
                                          <th className="text-right py-2 px-3 font-medium text-slate-500">Achievement</th>
                                          <th className="text-right py-2 px-3 font-medium text-slate-500">Slab Rate</th>
                                          <th className="text-right py-2 px-3 font-medium text-slate-500">Weight</th>
                                          <th className="text-right py-2 px-3 font-medium text-slate-500">Payout</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {payoutDetail.kpi_results.map(kpi => {
                                          const achColor = kpi.achievement_percent >= 100 ? 'text-emerald-600' :
                                                           kpi.achievement_percent >= 70 ? 'text-amber-600' : 'text-rose-600';
                                          return (
                                            <tr key={kpi.kpi_id} className="border-b border-slate-100 last:border-0">
                                              <td className="py-2 px-3">
                                                <div className="font-medium text-slate-800">{kpi.kpi_name}</div>
                                                <div className="text-[10px] text-slate-400 font-mono">{kpi.kpi_code}</div>
                                              </td>
                                              <td className="py-2 px-3 text-slate-500">{kpi.kpi_category}</td>
                                              <td className="py-2 px-3 text-right text-slate-600 font-mono">
                                                {kpi.unit === 'currency' ? formatCurrency(kpi.target_value) :
                                                 kpi.unit === 'percentage' ? `${kpi.target_value}%` :
                                                 kpi.target_value.toLocaleString()}
                                              </td>
                                              <td className="py-2 px-3 text-right text-slate-900 font-mono font-medium">
                                                {kpi.unit === 'currency' ? formatCurrency(kpi.actual_value) :
                                                 kpi.unit === 'percentage' ? `${kpi.actual_value}%` :
                                                 kpi.actual_value.toLocaleString()}
                                              </td>
                                              <td className="py-2 px-3 text-right">
                                                <span className={cn('font-bold', achColor)}>
                                                  {kpi.achievement_percent.toFixed(1)}%
                                                </span>
                                              </td>
                                              <td className="py-2 px-3 text-right text-slate-600 font-mono">{kpi.slab_rate}%</td>
                                              <td className="py-2 px-3 text-right text-slate-600">{kpi.weight}%</td>
                                              <td className="py-2 px-3 text-right font-semibold text-slate-900">{formatCurrency(kpi.weighted_payout)}</td>
                                            </tr>
                                          );
                                        })}
                                        {/* Helper Trip Bonus row — shows alongside KPI payouts */}
                                        {(() => {
                                          const details = typeof payoutDetail.calculation_details === 'string'
                                            ? (() => { try { return JSON.parse(payoutDetail.calculation_details); } catch { return {}; } })()
                                            : (payoutDetail.calculation_details || {});
                                          const helperBonus = details.helper_trip_bonus || 0;
                                          const trips = details.helper_trips;
                                          if (helperBonus <= 0) return null;
                                          return (
                                            <tr className="border-t-2 border-sky-200 bg-sky-50/50">
                                              <td className="py-2 px-3">
                                                <div className="font-medium text-sky-800">🚚 Helper Trip Bonus</div>
                                                <div className="text-[10px] text-sky-600">
                                                  {trips ? `Solo: ${trips.solo} · Paired: ${trips.paired} · Team: ${trips.team}` : 'Per-trip commission'}
                                                </div>
                                              </td>
                                              <td className="py-2 px-3 text-slate-500">Delivery</td>
                                              <td className="py-2 px-3 text-right text-slate-500">—</td>
                                              <td className="py-2 px-3 text-right text-slate-900 font-mono font-medium">
                                                {trips ? `${trips.trip_count} trips` : '—'}
                                              </td>
                                              <td className="py-2 px-3 text-right text-slate-500">
                                                {trips ? `${trips.total_days} days` : '—'}
                                              </td>
                                              <td className="py-2 px-3 text-right text-slate-500">—</td>
                                              <td className="py-2 px-3 text-right text-slate-500">—</td>
                                              <td className="py-2 px-3 text-right font-semibold text-sky-700">+{formatCurrency(helperBonus)}</td>
                                            </tr>
                                          );
                                        })()}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Coming Soon */}
      {!running && !result && pastRuns.length === 0 && (
        <div className="card p-8 text-center">
          <Calculator className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-slate-700 mb-1">Ready to Calculate</h3>
          <p className="text-slate-500 mb-4">Select a plan and period above, then click Run Calculation</p>
          <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
            <Sparkles className="w-4 h-4 text-violet-400" />
            <span>Coming soon: Export to Excel, bulk period calculations, scheduled runs</span>
          </div>
        </div>
      )}

      {/* Past Runs */}
      {pastRuns.length > 0 && (
        <div className="card">
          <div className="p-5 border-b border-slate-200">
            <h3 className="font-semibold text-slate-900">Past Calculation Runs</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {pastRuns.slice(0, 10).map(run => (
              <button
                key={run.id}
                onClick={() => loadRunDetail(run.id)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 text-left"
              >
                <div className="flex items-center gap-4">
                  <span className={cn('badge', getStatusColor(run.status))}>{getStatusLabel(run.status)}</span>
                  <div>
                    <div className="text-sm font-medium text-slate-900">{run.plan_name}</div>
                    <div className="text-xs text-slate-500">Period: {run.period} • {run.employee_count} employees</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-slate-900">{formatCurrency(run.total_payout)}</div>
                  <div className="text-xs text-slate-500">{formatDateTime(run.started_at)}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
