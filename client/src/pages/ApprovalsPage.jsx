import { useState, useEffect } from 'react';
import api from '../api/client';
import toast from 'react-hot-toast';
import { useAppStore } from '../store/store';
import {
  CheckCircle2, XCircle, Clock, ChevronRight, Shield, AlertTriangle,
  Lock, Send, Loader2, MessageSquare
} from 'lucide-react';
import { formatCurrency, cn, getStatusColor, getStatusLabel } from '../lib/utils';

const STAGES = [
  { status: 'submitted', label: 'Pending Manager', icon: Clock, nextAction: 'manager_approved', nextLabel: 'Approve (Manager)' },
  { status: 'manager_approved', label: 'Pending Finance', icon: Shield, nextAction: 'finance_approved', nextLabel: 'Approve (Finance)' },
  { status: 'finance_approved', label: 'Pending HR', icon: CheckCircle2, nextAction: 'hr_approved', nextLabel: 'Approve (HR)' },
  { status: 'hr_approved', label: 'Ready to Lock', icon: Lock, nextAction: 'locked', nextLabel: 'Lock Period' },
];

export default function ApprovalsPage() {
  const { currentPersona } = useAppStore();
  const [payouts, setPayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeStage, setActiveStage] = useState('submitted');
  const [processing, setProcessing] = useState(null);
  const [rejectDialog, setRejectDialog] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);

  useEffect(() => {
    fetchPayouts();
  }, [activeStage]);

  const fetchPayouts = () => {
    setLoading(true);
    api.get(`/approvals?status=${activeStage}`)
      .then(setPayouts)
      .finally(() => setLoading(false));
  };

  const handleAction = async (payoutId, action) => {
    setProcessing(payoutId);
    try {
      await api.post(`/approvals/${payoutId}/action`, {
        action,
        acted_by: currentPersona.id,
        acted_by_role: currentPersona.role,
        comments: action === 'rejected' ? rejectReason : `Approved by ${currentPersona.name}`,
      });
      toast.success(action === 'rejected' ? 'Payout rejected' : 'Payout approved');
      setRejectDialog(null);
      setRejectReason('');
      fetchPayouts();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setProcessing(null);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedIds.length === 0) return toast.error('Select payouts first');
    const stage = STAGES.find(s => s.status === activeStage);
    if (!stage) return;

    setProcessing('bulk');
    try {
      await api.post('/approvals/bulk-action', {
        payout_ids: selectedIds,
        action: stage.nextAction,
        acted_by: currentPersona.id,
        acted_by_role: currentPersona.role,
        comments: `Bulk approved by ${currentPersona.name}`,
      });
      toast.success(`${selectedIds.length} payouts approved`);
      setSelectedIds([]);
      fetchPayouts();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setProcessing(null);
    }
  };

  const currentStage = STAGES.find(s => s.status === activeStage);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-slate-900">Approvals</h1>
        <p className="text-sm text-slate-500 mt-1">Review and approve commission payouts through the 3-stage workflow</p>
      </div>

      {/* Stage Pipeline */}
      <div className="card p-4">
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
          {STAGES.map((stage, i) => (
            <div key={stage.status} className="flex items-center flex-1 min-w-0">
              <button
                onClick={() => { setActiveStage(stage.status); setSelectedIds([]); }}
                className={cn(
                  'flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors w-full',
                  activeStage === stage.status
                    ? 'bg-primary-100 text-primary-700 border border-primary-300'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                )}
              >
                <stage.icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{stage.label}</span>
              </button>
              {i < STAGES.length - 1 && <ChevronRight className="w-4 h-4 text-slate-300 mx-1 flex-shrink-0 hidden sm:block" />}
            </div>
          ))}
        </div>
      </div>

      {/* Bulk Actions */}
      {payouts.length > 0 && currentStage && (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={selectedIds.length === payouts.length && payouts.length > 0}
              onChange={e => setSelectedIds(e.target.checked ? payouts.map(p => p.id) : [])}
              className="rounded border-slate-300"
            />
            Select All ({payouts.length})
          </label>
          {selectedIds.length > 0 && (
            <button
              onClick={handleBulkApprove}
              disabled={processing === 'bulk'}
              className="btn-primary text-sm flex items-center gap-2"
            >
              {processing === 'bulk' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              {currentStage.nextLabel} ({selectedIds.length})
            </button>
          )}
        </div>
      )}

      {/* Payouts Table */}
      {loading ? (
        <div className="card p-8">
          <div className="space-y-4">
            {[1,2,3].map(i => <div key={i} className="h-16 bg-slate-100 rounded animate-pulse" />)}
          </div>
        </div>
      ) : payouts.length > 0 ? (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="py-3 px-4 w-10">
                    <input
                      type="checkbox"
                      checked={selectedIds.length === payouts.length}
                      onChange={e => setSelectedIds(e.target.checked ? payouts.map(p => p.id) : [])}
                      className="rounded border-slate-300"
                    />
                  </th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600">Employee</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600">Plan</th>
                  <th className="text-left py-3 px-4 font-medium text-slate-600">Period</th>
                  <th className="text-right py-3 px-4 font-medium text-slate-600">Gross</th>
                  <th className="text-right py-3 px-4 font-medium text-slate-600">Net Payout</th>
                  <th className="text-center py-3 px-4 font-medium text-slate-600">Eligibility</th>
                  <th className="text-center py-3 px-4 font-medium text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map(p => (
                  <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(p.id)}
                        onChange={e => {
                          setSelectedIds(prev =>
                            e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id)
                          );
                        }}
                        className="rounded border-slate-300"
                      />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-semibold">
                          {p.employee_name.split(' ').map(n => n[0]).join('')}
                        </div>
                        <div>
                          <div className="font-medium text-slate-900">{p.employee_name}</div>
                          <div className="text-xs text-slate-500">{p.role_name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600">{p.plan_name}</td>
                    <td className="py-3 px-4 text-slate-600">{p.period}</td>
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
                      <div className="flex items-center justify-center gap-2">
                        {currentStage && (
                          <button
                            onClick={() => handleAction(p.id, currentStage.nextAction)}
                            disabled={processing === p.id}
                            className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-100 transition-colors disabled:opacity-50"
                          >
                            {processing === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                            Approve
                          </button>
                        )}
                        <button
                          onClick={() => setRejectDialog(p.id)}
                          className="px-3 py-1 bg-rose-50 text-rose-700 rounded-lg text-xs font-medium hover:bg-rose-100 transition-colors"
                        >
                          <XCircle className="w-3 h-3 inline mr-1" />
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card p-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-slate-700 mb-1">No Pending Approvals</h3>
          <p className="text-slate-500">All payouts at this stage have been processed</p>
        </div>
      )}

      {/* Reject Dialog */}
      {rejectDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Reject Payout</h3>
            <p className="text-sm text-slate-500 mb-4">Please provide a reason for rejection (required)</p>
            <textarea
              className="input min-h-[100px] mb-4"
              placeholder="Enter rejection reason..."
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            />
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setRejectDialog(null); setRejectReason(''); }} className="btn-secondary">Cancel</button>
              <button
                onClick={() => handleAction(rejectDialog, 'rejected')}
                disabled={!rejectReason.trim() || processing}
                className="px-4 py-2 bg-rose-600 text-white rounded-lg font-medium hover:bg-rose-700 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
