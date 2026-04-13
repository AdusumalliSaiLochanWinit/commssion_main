import { useState, useEffect } from 'react';
import api from '../api/client';
import { ScrollText, Filter, ChevronDown, Clock, ArrowRight, AlertCircle } from 'lucide-react';
import { cn, getStatusLabel, formatDateTime } from '../lib/utils';

const ENTITY_TYPES = ['All', 'plan', 'payout', 'calculation', 'employee'];

const actionColors = {
  created: 'bg-emerald-100 text-emerald-800',
  activated: 'bg-blue-100 text-blue-800',
  updated: 'bg-amber-100 text-amber-800',
  submitted: 'bg-sky-100 text-sky-800',
  manager_approved: 'bg-indigo-100 text-indigo-800',
  finance_approved: 'bg-violet-100 text-violet-800',
  hr_approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
  locked: 'bg-slate-100 text-slate-800',
};

export default function AuditTrailPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [entityType, setEntityType] = useState('All');
  const [expandedEntry, setExpandedEntry] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = entityType !== 'All' ? `?entity_type=${entityType}` : '';
    api.get(`/audit${params}`)
      .then(setEntries)
      .catch(() => setError('Failed to load audit trail'))
      .finally(() => setLoading(false));
  }, [entityType]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-slate-200 rounded animate-pulse" />
        {[1,2,3,4,5].map(i => (
          <div key={i} className="card p-4 h-16 animate-pulse bg-slate-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-12 text-center">
        <AlertCircle className="w-12 h-12 text-rose-300 mx-auto mb-3" />
        <h3 className="text-lg font-medium text-slate-700 mb-1">Failed to Load Audit Trail</h3>
        <p className="text-slate-500 mb-4">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Trail</h1>
          <p className="text-slate-500 mt-1">Immutable log of all changes and calculations</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {ENTITY_TYPES.map(type => (
          <button
            key={type}
            onClick={() => setEntityType(type)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
              entityType === type
                ? 'bg-primary-600 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            )}
          >
            {type === 'All' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="space-y-3">
        {entries.map(entry => {
          const changes = typeof entry.changes === 'string' ? JSON.parse(entry.changes) : entry.changes;
          const isExpanded = expandedEntry === entry.id;

          return (
            <div key={entry.id} className="card overflow-hidden">
              <button
                onClick={() => setExpandedEntry(isExpanded ? null : entry.id)}
                className="w-full flex items-center gap-4 px-5 py-3 hover:bg-slate-50 transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4 text-slate-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn('badge', actionColors[entry.action] || 'badge-gray')}>
                      {getStatusLabel(entry.action)}
                    </span>
                    <span className="badge badge-gray">{entry.entity_type}</span>
                  </div>
                  <div className="text-sm text-slate-600">
                    Entity: <span className="font-mono text-xs">{entry.entity_id}</span>
                    {entry.performed_by && (
                      <span className="ml-3">by <span className="font-medium">{entry.performed_by}</span></span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs text-slate-500">{formatDateTime(entry.performed_at)}</div>
                  <ChevronDown className={cn('w-4 h-4 text-slate-400 ml-auto mt-1 transition-transform', isExpanded && 'rotate-180')} />
                </div>
              </button>

              {isExpanded && changes && (
                <div className="px-5 py-3 bg-slate-50 border-t border-slate-200">
                  <h4 className="text-xs font-medium text-slate-500 uppercase mb-2">Changes</h4>
                  <pre className="text-xs text-slate-700 bg-white p-3 rounded-lg border border-slate-200 overflow-x-auto">
                    {JSON.stringify(changes, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {entries.length === 0 && (
        <div className="card p-12 text-center">
          <ScrollText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-slate-700 mb-1">No Audit Entries</h3>
          <p className="text-slate-500">Audit trail entries will appear as changes are made</p>
        </div>
      )}
    </div>
  );
}
