import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAppStore } from '../store/store';
import toast from 'react-hot-toast';
import { FlaskConical, Play, Loader2, TrendingUp, TrendingDown, Minus, Sparkles, Info, X } from 'lucide-react';
import { formatCurrency, formatPercent, cn } from '../lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function SimulationPage() {
  const { selectedPeriod } = useAppStore();
  const [plans, setPlans] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [running, setRunning] = useState(false);
  const [baseline, setBaseline] = useState(null);
  const [simulation, setSimulation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showInfo, setShowInfo] = useState(false);

  // What-if sliders — defaults are set when plan is selected
  const [overrides, setOverrides] = useState({
    base_payout: 1000,
    target_multiplier: 100,
    multipliers: {},
  });

  useEffect(() => {
    api.get('/plans').then(p => {
      const active = p.filter(pl => pl.status === 'active');
      setPlans(active);
      if (active.length > 0) {
        setSelectedPlan(active[0].id);
        setOverrides(prev => ({ ...prev, base_payout: active[0].base_payout }));
      }
    }).finally(() => setLoading(false));
  }, []);

  const selectedPlanData = plans.find(p => p.id === selectedPlan);
  const planBase = selectedPlanData?.base_payout || 1000;
  const sliderMin = Math.max(100, Math.round(planBase * 0.25 / 100) * 100);
  const sliderMax = Math.round(planBase * 5 / 100) * 100;
  const sliderStep = Math.max(50, Math.round((sliderMax - sliderMin) / 40 / 50) * 50);

  const runBaseline = async () => {
    try {
      const res = await api.post('/simulation/run', {
        plan_id: selectedPlan,
        period: selectedPeriod,
        created_by: 'emp-01',
        overrides: {},
      });
      setBaseline(res);
      return res;
    } catch (err) {
      toast.error(err.message);
    }
  };

  const runSimulation = async () => {
    if (!selectedPlan) return toast.error('Select a plan first');
    setRunning(true);

    try {
      // Run baseline first (no overrides)
      const base = await runBaseline();

      // Run with overrides
      const sim = await api.post('/simulation/run', {
        plan_id: selectedPlan,
        period: selectedPeriod,
        created_by: 'emp-01',
        overrides,
      });

      setBaseline(base);
      setSimulation(sim);
      toast.success('Simulation complete!');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  const allComparisonData = baseline && simulation ? baseline.payouts
    .map(bp => {
      const sp = simulation.payouts.find(s => s.employee_id === bp.employee_id);
      return {
        name: bp.employee_name.split(' ')[0],
        fullName: bp.employee_name,
        baseline: bp.net_payout,
        simulation: sp?.net_payout || 0,
        diff: (sp?.net_payout || 0) - bp.net_payout,
      };
    })
    .sort((a, b) => b.simulation - a.simulation || b.baseline - a.baseline) : [];

  // Chart only shows employees with non-zero payouts (too many bars otherwise)
  const chartData = allComparisonData.filter(r => r.baseline > 0 || r.simulation > 0);
  const totalDiff = simulation && baseline ? simulation.total_payout - baseline.total_payout : 0;

  if (loading) return <div className="h-96 bg-slate-100 rounded-xl animate-pulse" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1">
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">What-If Simulation</h1>
          <p className="text-sm text-slate-500 mt-1">Test different scenarios and compare budget impact</p>
        </div>
        <button
          onClick={() => setShowInfo(true)}
          className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
          title="How simulation works"
        >
          <Info className="w-5 h-5 text-slate-500" />
        </button>
      </div>

      {/* Info Modal */}
      {showInfo && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowInfo(false)}>
          <div className="bg-white rounded-xl max-w-lg w-full shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-primary-600" />
                <h2 className="font-semibold text-slate-900">How Simulation Works</h2>
              </div>
              <button onClick={() => setShowInfo(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-sm text-slate-600">
              <div>
                <h4 className="font-medium text-slate-800 mb-1">What is it?</h4>
                <p>Simulation lets you test "what-if" scenarios by adjusting plan parameters without affecting real data. It runs the full 13-step calculation pipeline using your chosen overrides, then compares the results against a baseline (the plan's current configuration).</p>
              </div>
              <div>
                <h4 className="font-medium text-slate-800 mb-1">Parameters you can adjust</h4>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Base Payout</strong> — Change the base commission amount. See how increasing or decreasing it affects total budget.</li>
                  <li><strong>Target Multiplier</strong> — Scale all KPI targets up or down. For example, 150% makes targets 50% harder, so fewer employees will hit higher slabs. 75% makes targets easier.</li>
                  <li><strong>Strategic SKU Override</strong> — Override the strategic SKU percentage for all employees. Useful for modeling "what if strategic sales were higher/lower".</li>
                </ul>
              </div>
              <div>
                <h4 className="font-medium text-slate-800 mb-1">When to use it</h4>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Budget planning</strong> — See total payout impact before changing a plan's base amount.</li>
                  <li><strong>Target setting</strong> — Find the right target level that balances achievability with cost control.</li>
                  <li><strong>Scenario comparison</strong> — Compare current vs. proposed plan parameters side by side.</li>
                </ul>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-xs">
                Simulations are temporary and do not create approval entries or affect real payouts. Only "Calculate" runs create official payout records.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls */}
        <div className="lg:col-span-1 space-y-4">
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold text-slate-900">Scenario Parameters</h3>

            <div>
              <label className="label">Plan</label>
              <select className="input" value={selectedPlan} onChange={e => {
                setSelectedPlan(e.target.value);
                const p = plans.find(pl => pl.id === e.target.value);
                if (p) setOverrides(prev => ({ ...prev, base_payout: p.base_payout }));
                setBaseline(null);
                setSimulation(null);
              }}>
                {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>

            <div>
              <label className="label">Base Payout Override</label>
              <input
                type="range"
                min={sliderMin}
                max={sliderMax}
                step={sliderStep}
                value={overrides.base_payout}
                onChange={e => setOverrides({...overrides, base_payout: Number(e.target.value)})}
                className="w-full accent-primary-600"
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>{formatCurrency(sliderMin)}</span>
                <span className="font-semibold text-primary-600">{formatCurrency(overrides.base_payout)}</span>
                <span>{formatCurrency(sliderMax)}</span>
              </div>
              {overrides.base_payout !== planBase && (
                <p className="text-xs text-amber-600 mt-1">Plan default: {formatCurrency(planBase)}</p>
              )}
            </div>

            <div>
              <label className="label">Revenue Target Multiplier</label>
              <input
                type="range"
                min={50}
                max={200}
                step={5}
                value={overrides.target_multiplier}
                onChange={e => setOverrides({...overrides, target_multiplier: Number(e.target.value)})}
                className="w-full accent-primary-600"
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>50%</span>
                <span className="font-semibold text-primary-600">{overrides.target_multiplier}%</span>
                <span>200%</span>
              </div>
              {overrides.target_multiplier !== 100 && (
                <p className="text-xs text-amber-600 mt-1">Targets will be scaled to {overrides.target_multiplier}% of plan values</p>
              )}
            </div>

            <div>
              <label className="label">Strategic SKU % Override</label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={(overrides.multipliers?.strategic_sku_percent ?? 50)}
                onChange={e => setOverrides({
                  ...overrides,
                  multipliers: { ...overrides.multipliers, strategic_sku_percent: Number(e.target.value) }
                })}
                className="w-full accent-primary-600"
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>0%</span>
                <span className="font-semibold text-primary-600">{overrides.multipliers?.strategic_sku_percent ?? 50}%</span>
                <span>100%</span>
              </div>
            </div>

            <button
              onClick={runSimulation}
              disabled={running}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {running ? 'Running...' : 'Run Simulation'}
            </button>
          </div>

          {/* Budget Impact */}
          {simulation && baseline && (
            <div className="card p-5 space-y-3">
              <h3 className="font-semibold text-slate-900">Budget Impact</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Baseline Total</span>
                  <span className="text-sm font-medium">{formatCurrency(baseline.total_payout)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Simulation Total</span>
                  <span className="text-sm font-medium">{formatCurrency(simulation.total_payout)}</span>
                </div>
                <div className="pt-2 border-t border-slate-200 flex justify-between">
                  <span className="text-sm font-medium text-slate-700">Difference</span>
                  <span className={cn('text-sm font-bold', totalDiff > 0 ? 'text-rose-600' : totalDiff < 0 ? 'text-emerald-600' : 'text-slate-600')}>
                    {totalDiff > 0 ? '+' : ''}{formatCurrency(totalDiff)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">% Change</span>
                  <span className={cn('text-sm font-bold', totalDiff > 0 ? 'text-rose-600' : totalDiff < 0 ? 'text-emerald-600' : 'text-slate-600')}>
                    {baseline.total_payout > 0 ? `${totalDiff > 0 ? '+' : ''}${((totalDiff / baseline.total_payout) * 100).toFixed(1)}%` : 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Employees Affected</span>
                  <span className="text-sm font-medium">{allComparisonData.filter(r => r.diff !== 0).length} of {allComparisonData.length}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Results Comparison */}
        <div className="lg:col-span-2 space-y-6">
          {allComparisonData.length > 0 && (
            <>
              {/* Chart — only employees with payouts */}
              <div className="card p-5">
                <h3 className="font-semibold text-slate-900 mb-4">Payout Comparison</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `AED ${(v/1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(value) => formatCurrency(value)}
                      contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
                    />
                    <Legend />
                    <Bar dataKey="baseline" name="Baseline" fill="#94a3b8" radius={[4,4,0,0]} />
                    <Bar dataKey="simulation" name="Simulation" fill="#6366f1" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Detail Table */}
              <div className="card">
                <div className="p-5 border-b border-slate-200">
                  <h3 className="font-semibold text-slate-900">Detailed Comparison</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50">
                        <th className="text-left py-3 px-5 font-medium text-slate-600">Employee</th>
                        <th className="text-right py-3 px-4 font-medium text-slate-600">Baseline</th>
                        <th className="text-right py-3 px-4 font-medium text-slate-600">Simulation</th>
                        <th className="text-right py-3 px-4 font-medium text-slate-600">Difference</th>
                        <th className="text-center py-3 px-4 font-medium text-slate-600">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allComparisonData.map(row => (
                        <tr key={row.fullName} className="border-b border-slate-100">
                          <td className="py-3 px-5 font-medium text-slate-900">{row.fullName}</td>
                          <td className="py-3 px-4 text-right text-slate-600">{formatCurrency(row.baseline)}</td>
                          <td className="py-3 px-4 text-right font-medium text-slate-900">{formatCurrency(row.simulation)}</td>
                          <td className="py-3 px-4 text-right">
                            <span className={cn('font-medium', row.diff > 0 ? 'text-emerald-600' : row.diff < 0 ? 'text-rose-600' : 'text-slate-400')}>
                              {row.diff > 0 ? '+' : ''}{formatCurrency(row.diff)}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            {row.diff > 0 ? <TrendingUp className="w-4 h-4 text-emerald-500 mx-auto" /> :
                             row.diff < 0 ? <TrendingDown className="w-4 h-4 text-rose-500 mx-auto" /> :
                             <Minus className="w-4 h-4 text-slate-400 mx-auto" />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {!simulation && (
            <div className="card p-12 text-center">
              <FlaskConical className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h3 className="text-lg font-medium text-slate-700 mb-1">Run a Simulation</h3>
              <p className="text-slate-500 mb-4">Adjust the parameters on the left and click Run to see how changes affect payouts</p>
              <button onClick={() => setShowInfo(true)} className="inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700">
                <Info className="w-4 h-4" /> Learn how simulation works
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
