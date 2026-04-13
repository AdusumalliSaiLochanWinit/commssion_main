import { useState, useEffect } from 'react';
import api from '../api/client';
import { useAppStore } from '../store/store';
import { formatCurrency, formatPercent, cn } from '../lib/utils';
import {
  Trophy, Medal, Crown, TrendingUp, TrendingDown, DollarSign, Users, Target,
  BarChart3, Wallet, Award, Flame, Star, ChevronRight, ChevronDown, Zap, Shield,
  Filter, ArrowUpRight
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, Legend
} from 'recharts';

const TIER_CONFIG = {
  champion:       { label: 'Champions',       bg: 'bg-amber-50/80',   text: 'text-amber-700',   border: 'border-amber-200/60', barBg: 'bg-amber-300',   icon: Crown,  dot: 'bg-amber-400' },
  high_performer: { label: 'High Performers', bg: 'bg-teal-50/80',    text: 'text-teal-700',    border: 'border-teal-200/60',  barBg: 'bg-teal-300',    icon: Flame,  dot: 'bg-teal-400' },
  on_track:       { label: 'On Track',        bg: 'bg-sky-50/80',     text: 'text-sky-700',     border: 'border-sky-200/60',   barBg: 'bg-sky-300',     icon: Target, dot: 'bg-sky-400' },
  developing:     { label: 'Developing',      bg: 'bg-slate-50/80',   text: 'text-slate-500',   border: 'border-slate-200/60', barBg: 'bg-slate-200',   icon: Shield, dot: 'bg-slate-300' },
  below_target:   { label: 'Below Target',    bg: 'bg-rose-50/60',    text: 'text-rose-400',    border: 'border-rose-200/40',  barBg: 'bg-rose-200',    icon: Target, dot: 'bg-rose-300' },
};

const PASTEL_CHART = ['#a78bfa', '#6ee7b7', '#fcd34d', '#fca5a5', '#93c5fd', '#c4b5fd', '#a5f3fc'];

export default function DashboardPage() {
  const { currentPersona, selectedPeriod } = useAppStore();
  const roleLevel = getRoleLevel(currentPersona.roleId);

  if (roleLevel >= 2) return <CommissionDashboard period={selectedPeriod} />;
  return <SalespersonDashboard employeeId={currentPersona.id} period={selectedPeriod} persona={currentPersona} />;
}

function getRoleLevel(roleId) {
  const levels = {
    'role-psr': 1, 'role-sr': 1, 'role-de': 1, 'role-mer': 1, 'role-salesman': 1,
    'role-ss': 2, 'role-asm': 3, 'role-kam': 3,
    'role-rsm': 4, 'role-zsm': 5, 'role-nsm': 6,
  };
  return levels[roleId] || 6;
}

// ==================== COMMISSION DASHBOARD ====================
function CommissionDashboard({ period }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedPlan, setExpandedPlan] = useState(null);
  const [selectedKpi, setSelectedKpi] = useState('all');

  useEffect(() => {
    setLoading(true);
    api.get(`/dashboard/executive?period=${period}`)
      .then(d => { setData(d); setSelectedKpi('all'); })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [period]);

  if (loading) return <DashboardSkeleton />;
  if (!data || !data.leaderboard) return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Commission Dashboard</h1>
      <div className="card p-12 text-center">
        <Trophy className="w-12 h-12 text-slate-200 mx-auto mb-3" />
        <h3 className="text-lg font-medium text-slate-600 mb-1">No Commission Data</h3>
        <p className="text-slate-400">Run calculations for this period to see the leaderboard</p>
      </div>
    </div>
  );

  const { leaderboard, tiers, plans, distribution, by_territory, kpi_list } = data;
  const topEarners = leaderboard.filter(e => e.total_payout > 0);
  const top3 = topEarners.slice(0, 3);

  // KPI filter logic
  const filteredLeaderboard = selectedKpi === 'all'
    ? topEarners
    : leaderboard
        .filter(e => e.kpis && e.kpis[selectedKpi])
        .map(e => ({
          ...e,
          _kpiAch: e.kpis[selectedKpi].achievement,
          _kpiActual: e.kpis[selectedKpi].actual,
          _kpiTarget: e.kpis[selectedKpi].target,
          _kpiPayout: e.kpis[selectedKpi].payout,
        }))
        .sort((a, b) => b._kpiAch - a._kpiAch);

  const selectedKpiInfo = kpi_list?.find(k => k.id === selectedKpi);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-slate-800">Commission Dashboard</h1>
        <p className="text-sm text-slate-400 mt-1">Performance leaderboard & incentive analytics</p>
      </div>

      {/* Hero Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <GlassCard icon={Wallet} label="Total Commissions" value={formatCurrency(data.total_payouts)} gradient="from-violet-100 to-purple-50" iconColor="text-violet-500" />
        <GlassCard icon={DollarSign} label="Total Sales" value={formatCurrency(data.total_sales)} gradient="from-emerald-100 to-teal-50" iconColor="text-emerald-500" />
        <GlassCard icon={Award} label="Commission ROI" value={`${data.commission_roi}x`} gradient="from-amber-100 to-orange-50" iconColor="text-amber-500" sub="Sales per AED spent" />
        <GlassCard icon={Users} label="Earning Commission" value={`${topEarners.length} / ${leaderboard.length}`} gradient="from-sky-100 to-cyan-50" iconColor="text-sky-500" />
        <GlassCard icon={BarChart3} label="Avg Payout" value={formatCurrency(data.avg_payout)} gradient="from-rose-100 to-pink-50" iconColor="text-rose-400" sub={`Median: ${formatCurrency(data.median_payout)}`} />
      </div>

      {/* Podium */}
      {top3.length >= 3 && (
        <div className="card p-6 bg-gradient-to-br from-slate-50 via-white to-violet-50/30 border border-slate-100">
          <h3 className="font-semibold text-slate-700 mb-5 flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" /> Top Performers
          </h3>
          <div className="flex flex-col sm:flex-row items-center sm:items-end justify-center gap-4 max-w-2xl mx-auto">
            <PodiumCard rank={2} emp={top3[1]} />
            <PodiumCard rank={1} emp={top3[0]} highlight />
            <PodiumCard rank={3} emp={top3[2]} />
          </div>
        </div>
      )}

      {/* KPI Filter */}
      {kpi_list && kpi_list.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Filter className="w-4 h-4" />
            <span className="font-medium">Filter by KPI:</span>
          </div>
          <button
            onClick={() => setSelectedKpi('all')}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
              selectedKpi === 'all'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300'
            )}
          >
            All KPIs
          </button>
          {kpi_list.map(kpi => (
            <button
              key={kpi.id}
              onClick={() => setSelectedKpi(kpi.id)}
              className={cn(
                'px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                selectedKpi === kpi.id
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'bg-white text-slate-500 border border-slate-200 hover:border-violet-300'
              )}
            >
              {kpi.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Leaderboard */}
        <div className="lg:col-span-2">
          <div className="card border border-slate-100">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-700 flex items-center gap-2">
                <Medal className="w-5 h-5 text-violet-400" />
                {selectedKpi === 'all' ? 'Full Leaderboard' : `${selectedKpiInfo?.name || 'KPI'} Leaderboard`}
              </h3>
              <span className="text-xs text-slate-400">
                {selectedKpi === 'all'
                  ? `${topEarners.length} earning / ${leaderboard.length} total`
                  : `${filteredLeaderboard.length} employees`
                }
              </span>
            </div>
            <div className="divide-y divide-slate-50 max-h-[560px] overflow-y-auto">
              {selectedKpi === 'all' ? (
                filteredLeaderboard.map(emp => (
                  <LeaderboardRow key={emp.employee_id} emp={emp} maxPayout={top3[0]?.total_payout || 1} />
                ))
              ) : (
                filteredLeaderboard.map((emp, i) => (
                  <KpiLeaderboardRow key={emp.employee_id} emp={emp} rank={i + 1} kpiUnit={selectedKpiInfo?.unit} />
                ))
              )}
              {filteredLeaderboard.length === 0 && (
                <div className="p-8 text-center text-slate-300">No data for this filter</div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Performance Tiers */}
          <div className="card p-5 border border-slate-100">
            <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" /> Performance Tiers
            </h3>
            <div className="space-y-3">
              {Object.entries(TIER_CONFIG).map(([key, cfg]) => {
                const count = tiers[key] || 0;
                const pct = leaderboard.length > 0 ? (count / leaderboard.length * 100) : 0;
                const Icon = cfg.icon;
                return (
                  <div key={key} className="flex items-center gap-3">
                    <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', cfg.bg)}>
                      <Icon className={cn('w-4 h-4', cfg.text)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-1">
                        <span className="text-xs font-medium text-slate-600">{cfg.label}</span>
                        <span className={cn('text-xs font-bold', cfg.text)}>{count}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full transition-all duration-700', cfg.barBg)} style={{ width: `${Math.max(pct, count > 0 ? 3 : 0)}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active Plans */}
          <div className="card p-5 border border-slate-100">
            <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Star className="w-5 h-5 text-violet-400" /> Active Plans
            </h3>
            <div className="space-y-2">
              {plans.map(plan => (
                <button
                  key={plan.plan_id}
                  className={cn(
                    'w-full text-left p-3 rounded-lg border transition-all',
                    expandedPlan === plan.plan_id
                      ? 'border-violet-200 bg-violet-50/50'
                      : 'border-slate-100 hover:border-violet-200 hover:bg-slate-50/50'
                  )}
                  onClick={() => setExpandedPlan(expandedPlan === plan.plan_id ? null : plan.plan_id)}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700 truncate">{plan.plan_name}</span>
                    <ChevronRight className={cn('w-4 h-4 text-slate-300 transition-transform', expandedPlan === plan.plan_id && 'rotate-90')} />
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
                    <span>Base: {formatCurrency(plan.base_payout)}</span>
                    <span>Total: <span className="font-semibold text-slate-600">{formatCurrency(plan.total_payout)}</span></span>
                  </div>
                  {expandedPlan === plan.plan_id && (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
                      {leaderboard
                        .filter(e => e.plans.some(p => p.plan_name === plan.plan_name && p.net_payout > 0))
                        .slice(0, 5)
                        .map(e => {
                          const planPayout = e.plans.find(p => p.plan_name === plan.plan_name);
                          return (
                            <div key={e.employee_id} className="flex justify-between text-xs">
                              <span className="text-slate-500">{e.employee_name}</span>
                              <span className="font-medium text-slate-700">{formatCurrency(planPayout?.net_payout || 0)}</span>
                            </div>
                          );
                        })
                      }
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5 border border-slate-100">
          <h3 className="font-semibold text-slate-700 mb-4">Payout Distribution</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={distribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="range" tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
              <Tooltip formatter={v => [`${v} employees`, 'Count']} contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                {distribution.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? '#e2e8f0' : PASTEL_CHART[i % PASTEL_CHART.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-5 border border-slate-100">
          <h3 className="font-semibold text-slate-700 mb-4">Commission by Territory</h3>
          {by_territory.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={by_territory} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="territory" tick={{ fontSize: 10, fill: '#64748b' }} width={75} />
                <Tooltip formatter={v => formatCurrency(v)} contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="payout" name="Commission" fill="#c4b5fd" radius={[0, 4, 4, 0]} />
                <Bar dataKey="sales" name="Sales" fill="#6ee7b7" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[240px] flex items-center justify-center text-slate-300 text-sm">No territory data</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== PODIUM ====================
function PodiumCard({ rank, emp, highlight }) {
  const colors = {
    1: { bg: 'from-amber-50 to-yellow-50', border: 'border-amber-200/60', pedestal: 'bg-amber-200', emoji: '👑', h: 'h-28' },
    2: { bg: 'from-slate-50 to-gray-50', border: 'border-slate-200/60', pedestal: 'bg-slate-200', emoji: '🥈', h: 'h-20' },
    3: { bg: 'from-orange-50 to-amber-50', border: 'border-orange-200/50', pedestal: 'bg-orange-200', emoji: '🥉', h: 'h-16' },
  };
  const c = colors[rank];
  const initials = emp.employee_name.split(' ').map(n => n[0]).join('').slice(0, 2);

  return (
    <div className="flex-1 max-w-[180px]">
      <div className={cn(
        'rounded-xl border p-4 text-center bg-gradient-to-b transition-all',
        c.bg, c.border,
        highlight && 'shadow-md shadow-amber-100/50 -translate-y-2'
      )}>
        <div className="text-xl mb-1">{c.emoji}</div>
        <div className="w-10 h-10 rounded-full bg-white/80 border mx-auto mb-2 flex items-center justify-center text-xs font-bold text-slate-600"
          style={{ borderColor: rank === 1 ? '#fbbf24' : rank === 2 ? '#94a3b8' : '#fb923c' }}>
          {initials}
        </div>
        <p className="text-sm font-semibold text-slate-700 truncate">{emp.employee_name.split(' ')[0]}</p>
        <p className="text-[11px] text-slate-400 mb-1">{emp.territory || ''}</p>
        <p className="text-base font-bold text-slate-800">{formatCurrency(emp.total_payout)}</p>
        <p className="text-[11px] text-slate-400">{formatPercent(emp.avg_achievement)} avg</p>
      </div>
      <div className={cn('mx-auto rounded-b-lg text-center py-1', c.h, c.pedestal)} style={{ width: '55%' }}>
        <span className="text-white/80 text-[10px] font-bold">{rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd'}</span>
      </div>
    </div>
  );
}

// ==================== LEADERBOARD ROW ====================
function LeaderboardRow({ emp, maxPayout }) {
  const cfg = TIER_CONFIG[emp.tier] || TIER_CONFIG.below_target;
  const barWidth = maxPayout > 0 ? (emp.total_payout / maxPayout * 100) : 0;
  const initials = emp.employee_name.split(' ').map(n => n[0]).join('').slice(0, 2);

  return (
    <div className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50/50 transition-colors">
      <div className="w-7 text-center">
        {emp.rank <= 3 ? (
          <span className="text-base">{['', '🥇', '🥈', '🥉'][emp.rank]}</span>
        ) : (
          <span className="text-xs font-semibold text-slate-300">#{emp.rank}</span>
        )}
      </div>

      <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold border', cfg.bg, cfg.text, cfg.border)}>
        {initials}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700 truncate">{emp.employee_name}</span>
          <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium', cfg.bg, cfg.text)}>
            {cfg.label}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <div className="flex-1 h-1.5 bg-slate-100/80 rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full transition-all duration-700', cfg.barBg)} style={{ width: `${barWidth}%` }} />
          </div>
          <span className="text-[10px] text-slate-400 whitespace-nowrap">{formatPercent(emp.avg_achievement)}</span>
        </div>
      </div>

      <div className="hidden md:flex items-center gap-1">
        {emp.plans.filter(p => p.net_payout > 0).map((p, i) => (
          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-md bg-violet-50 text-violet-600 font-medium" title={p.plan_name}>
            {formatCurrency(p.net_payout)}
          </span>
        ))}
      </div>

      <div className="text-right min-w-[90px]">
        <p className="text-sm font-bold text-slate-700">{formatCurrency(emp.total_payout)}</p>
        <p className="text-[10px] text-slate-400">Sales: {formatCurrency(emp.total_sales)}</p>
      </div>
    </div>
  );
}

// ==================== KPI LEADERBOARD ROW ====================
function KpiLeaderboardRow({ emp, rank, kpiUnit }) {
  const ach = emp._kpiAch || 0;
  const barColor = ach >= 120 ? 'bg-amber-300' : ach >= 100 ? 'bg-teal-300' : ach >= 80 ? 'bg-sky-300' : ach >= 50 ? 'bg-slate-200' : 'bg-rose-200';
  const initials = emp.employee_name.split(' ').map(n => n[0]).join('').slice(0, 2);

  return (
    <div className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50/50 transition-colors">
      <div className="w-7 text-center">
        {rank <= 3 ? (
          <span className="text-base">{['', '🥇', '🥈', '🥉'][rank]}</span>
        ) : (
          <span className="text-xs font-semibold text-slate-300">#{rank}</span>
        )}
      </div>

      <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold border bg-slate-50 text-slate-500 border-slate-200">
        {initials}
      </div>

      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-slate-700 truncate block">{emp.employee_name}</span>
        <div className="flex items-center gap-3 mt-1">
          <div className="flex-1 h-1.5 bg-slate-100/80 rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full transition-all duration-700', barColor)} style={{ width: `${Math.min(ach, 150) / 1.5}%` }} />
          </div>
          <span className={cn('text-[11px] font-semibold whitespace-nowrap', ach >= 100 ? 'text-teal-600' : ach >= 80 ? 'text-sky-600' : 'text-slate-400')}>
            {formatPercent(ach)}
          </span>
        </div>
      </div>

      <div className="text-right min-w-[100px]">
        <p className="text-sm text-slate-600">
          {kpiUnit === 'currency' ? formatCurrency(emp._kpiActual) : Number(emp._kpiActual).toFixed(1)}
          <span className="text-slate-300"> / </span>
          {kpiUnit === 'currency' ? formatCurrency(emp._kpiTarget) : emp._kpiTarget}
        </p>
        <p className="text-[10px] text-slate-400">Payout: {formatCurrency(emp._kpiPayout)}</p>
      </div>
    </div>
  );
}

// ==================== GLASS CARD ====================
function GlassCard({ icon: Icon, label, value, gradient, iconColor, sub }) {
  return (
    <div className={cn('rounded-xl p-4 bg-gradient-to-br border border-white/60 shadow-sm', gradient)}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-white/60 flex items-center justify-center shrink-0">
          <Icon className={cn('w-4 h-4', iconColor)} />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500 leading-tight">{label}</p>
          <p className="text-lg font-bold text-slate-800 leading-tight truncate">{value}</p>
          {sub && <p className="text-[10px] text-slate-400 truncate">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

// ==================== SALESPERSON DASHBOARD ====================
function SalespersonDashboard({ employeeId, period, persona }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/dashboard/salesperson/${employeeId}?period=${period}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [employeeId, period]);

  if (loading) return <DashboardSkeleton />;
  if (!data) return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">My Dashboard</h1>
      <p className="text-slate-400 mt-1">Welcome back, {persona.name}</p>
      <div className="card p-12 text-center">
        <Trophy className="w-12 h-12 text-slate-200 mx-auto mb-3" />
        <h3 className="text-lg font-medium text-slate-600 mb-1">No Commission Data</h3>
        <p className="text-slate-400">Run a calculation for this period to see your dashboard</p>
      </div>
    </div>
  );

  const { sales, payout, kpi_results } = data;
  const collectionPercent = sales.total_sales > 0 ? (sales.total_collections / sales.total_sales * 100) : 0;
  const returnPercent = sales.total_sales > 0 ? (sales.total_returns / sales.total_sales * 100) : 0;

  const kpiChartData = kpi_results.map(k => ({
    name: k.code.replace(/_/g, ' ').slice(0, 12),
    achievement: Math.min(k.achievement_percent, 150),
  }));

  const payoutBreakdown = payout ? [
    { name: 'Gross', value: payout.gross_payout },
    { name: 'Multiplier', value: payout.multiplier_amount },
    { name: 'Penalty', value: -payout.penalty_amount },
    { name: 'Cap Adj', value: -payout.cap_adjustment },
  ].filter(d => d.value !== 0) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">My Dashboard</h1>
        <p className="text-slate-400 mt-1">Welcome back, {persona.name}</p>
      </div>

      {payout && (
        <div className="card p-6 bg-gradient-to-r from-violet-500 to-purple-500 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-violet-200 text-sm font-medium">Estimated Commission Payout</p>
              <p className="text-4xl font-bold mt-1">{formatCurrency(payout.net_payout)}</p>
              <p className="text-violet-200 text-sm mt-2">
                Status: <span className="text-white font-medium">{payout.approval_status?.replace(/_/g, ' ').toUpperCase()}</span>
              </p>
            </div>
            <Wallet className="w-16 h-16 text-violet-300/40" />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <GlassCard icon={DollarSign} label="Total Sales" value={formatCurrency(sales.total_sales)} gradient="from-emerald-100 to-teal-50" iconColor="text-emerald-500" />
        <GlassCard icon={Target} label="Units Sold" value={sales.total_units.toLocaleString()} gradient="from-sky-100 to-cyan-50" iconColor="text-sky-500" />
        <GlassCard icon={TrendingUp} label="Collection %" value={formatPercent(collectionPercent)} gradient="from-amber-100 to-orange-50" iconColor="text-amber-500" />
        <GlassCard icon={TrendingDown} label="Return %" value={formatPercent(returnPercent)} gradient={returnPercent > 8 ? 'from-rose-100 to-pink-50' : 'from-slate-100 to-gray-50'} iconColor={returnPercent > 8 ? 'text-rose-500' : 'text-slate-400'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {kpiChartData.length > 0 && (
          <div className="card p-5 border border-slate-100">
            <h3 className="font-semibold text-slate-700 mb-4">KPI Achievement</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={kpiChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" domain={[0, 150]} tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748b' }} width={90} />
                <Tooltip formatter={v => `${v.toFixed(1)}%`} />
                <Bar dataKey="achievement" fill="#a78bfa" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {payoutBreakdown.length > 0 && (
          <div className="card p-5 border border-slate-100">
            <h3 className="font-semibold text-slate-700 mb-4">Payout Breakdown</h3>
            <div className="space-y-3">
              {payoutBreakdown.map(item => (
                <div key={item.name} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                  <span className="text-sm text-slate-500">{item.name}</span>
                  <span className={cn('text-sm font-semibold', item.value >= 0 ? 'text-slate-700' : 'text-rose-400')}>
                    {item.value >= 0 ? '+' : ''}{formatCurrency(item.value)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 border-t-2 border-slate-200">
                <span className="text-sm font-bold text-slate-700">Net Payout</span>
                <span className="text-lg font-bold text-violet-600">{formatCurrency(payout.net_payout)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {kpi_results.length > 0 && (
        <div className="card border border-slate-100">
          <div className="p-5 border-b border-slate-100">
            <h3 className="font-semibold text-slate-700">KPI Detail</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left py-3 px-5 font-medium text-slate-500">KPI</th>
                  <th className="text-right py-3 px-4 font-medium text-slate-500">Target</th>
                  <th className="text-right py-3 px-4 font-medium text-slate-500">Actual</th>
                  <th className="text-right py-3 px-4 font-medium text-slate-500">Achievement</th>
                  <th className="text-right py-3 px-4 font-medium text-slate-500">Weight</th>
                  <th className="text-right py-3 px-4 font-medium text-slate-500">Payout</th>
                </tr>
              </thead>
              <tbody>
                {kpi_results.map(k => (
                  <tr key={k.kpi_id || k.code} className="border-b border-slate-50">
                    <td className="py-3 px-5">
                      <div className="font-medium text-slate-700">{k.kpi_name}</div>
                      <div className="text-[11px] text-slate-400">{k.category}</div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-500">
                      {k.unit === 'currency' ? formatCurrency(k.target_value) : k.target_value}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-slate-700">
                      {k.unit === 'currency' ? formatCurrency(k.actual_value) : Number(k.actual_value).toFixed(1)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <span className={cn('font-semibold', k.achievement_percent >= 100 ? 'text-teal-600' : k.achievement_percent >= 70 ? 'text-amber-500' : 'text-rose-400')}>
                        {formatPercent(k.achievement_percent)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-slate-500">{k.weight}%</td>
                    <td className="py-3 px-4 text-right font-semibold text-slate-700">{formatCurrency(k.weighted_payout)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ==================== SKELETON ====================
function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 bg-slate-100 rounded animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="rounded-xl p-4 bg-slate-50"><div className="h-14 bg-slate-100 rounded animate-pulse" /></div>
        ))}
      </div>
      <div className="rounded-xl p-5 h-48 animate-pulse bg-slate-50" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl p-5 h-96 animate-pulse bg-slate-50" />
        <div className="rounded-xl p-5 h-96 animate-pulse bg-slate-50" />
      </div>
    </div>
  );
}
