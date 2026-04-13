import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { FileText, Plus, Calendar, Users, Target, MoreVertical, Building2, AlertCircle, Archive } from 'lucide-react';
import { getStatusColor, getStatusLabel, formatCurrency, formatDate, cn } from '../lib/utils';

export default function PlanListPage() {
  const [allPlans, setAllPlans] = useState([]);
  const [statusFilter, setStatusFilter] = useState('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/plans')
      .then(setAllPlans)
      .catch(() => setError('Failed to load plans'))
      .finally(() => setLoading(false));
  }, []);

  const plans = statusFilter === 'all'
    ? allPlans
    : allPlans.filter(p => p.status === statusFilter);

  const activeCount = allPlans.filter(p => p.status === 'active').length;
  const draftCount = allPlans.filter(p => p.status === 'draft').length;
  const archivedCount = allPlans.filter(p => p.status === 'archived' || p.status === 'expired').length;

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-neutral-200 rounded animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {[1,2].map(i => (
            <div key={i} className="card p-6 space-y-4">
              <div className="h-6 w-48 bg-neutral-200 rounded animate-pulse" />
              <div className="h-4 w-full bg-neutral-100 rounded animate-pulse" />
              <div className="h-4 w-2/3 bg-neutral-100 rounded animate-pulse" />
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
        <h3 className="text-lg font-medium text-neutral-700 mb-1">Failed to Load Plans</h3>
        <p className="text-neutral-500 mb-4">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-neutral-900">Commission Plans</h1>
          <p className="text-sm text-neutral-500 mt-1">Manage incentive plan configurations</p>
        </div>
        <button
          onClick={() => navigate('/plans/new')}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Plan
        </button>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { key: 'active', label: 'Active', count: activeCount, color: 'emerald' },
          { key: 'draft', label: 'Drafts', count: draftCount, color: 'amber' },
          { key: 'archived', label: 'Archived', count: archivedCount, color: 'slate' },
          { key: 'all', label: 'All', count: allPlans.length, color: 'slate' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-lg border transition-colors flex items-center gap-2',
              statusFilter === tab.key
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'
            )}
          >
            {tab.label}
            <span className={cn(
              'px-1.5 py-0.5 text-xs rounded-full',
              statusFilter === tab.key ? 'bg-white/20 text-white' : 'bg-neutral-100 text-neutral-500'
            )}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {plans.map(plan => (
          <div
            key={plan.id}
            onClick={() => navigate(`/plans/${plan.id}`)}
            className="card p-6 hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-neutral-900">{plan.name}</h3>
                  <p className="text-xs text-neutral-500 mt-0.5">{plan.plan_type.charAt(0).toUpperCase() + plan.plan_type.slice(1)}</p>
                </div>
              </div>
              <span className={cn('badge', getStatusColor(plan.status))}>
                {getStatusLabel(plan.status)}
              </span>
            </div>

            {plan.description && (
              <p className="text-sm text-neutral-600 mb-4 line-clamp-2">{plan.description}</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Calendar className="w-4 h-4" />
                <span>{formatDate(plan.effective_from)} to {formatDate(plan.effective_to)}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Target className="w-4 h-4" />
                <span>{plan.kpi_count > 0 ? `${plan.kpi_count} KPIs` : '🚚 Per-Trip Commission'}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 mb-3">
              {plan.base_payout > 0 ? (
                <>
                  <span className="text-xs text-neutral-400">Base Payout:</span>
                  <span className="text-sm font-semibold text-neutral-900">{formatCurrency(plan.base_payout)}</span>
                </>
              ) : plan.kpi_count === 0 ? (
                <>
                  <span className="text-xs text-sky-500">🚚 Trip-Based:</span>
                  <span className="text-sm font-semibold text-sky-700">Solo 12 · Pair 7 · Team 5 AED/day</span>
                </>
              ) : (
                <>
                  <span className="text-xs text-neutral-400">Base Payout:</span>
                  <span className="text-sm font-semibold text-neutral-900">{formatCurrency(plan.base_payout)}</span>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-1.5">
              {plan.roles?.map(role => (
                <span key={role.id} className="badge badge-info text-xs">
                  {role.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {plans.length === 0 && (
        <div className="text-center py-12 card">
          <FileText className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-neutral-700 mb-1">No Plans Yet</h3>
          <p className="text-neutral-500 mb-4">Create your first commission plan to get started</p>
          <button onClick={() => navigate('/plans/new')} className="btn-primary">
            <Plus className="w-4 h-4 mr-2 inline" />
            Create Plan
          </button>
        </div>
      )}
    </div>
  );
}
