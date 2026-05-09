import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { useAppStore } from '../store/store';
import toast from 'react-hot-toast';
import { formatCurrency, formatNumber, formatDate } from '../lib/utils';
import { ArrowDownUp, RefreshCcw } from 'lucide-react';

export default function TransactionsPage() {
  const { selectedPeriod } = useAppStore();
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortDir, setSortDir] = useState('desc'); // date

  const fetchData = async () => {
    setLoading(true);
    try {
      const [emps, tx] = await Promise.all([
        api.get('/employees'),
        api.get('/transactions', {
          params: {
            period: selectedPeriod,
            employee_id: employeeId || undefined,
            limit: 500,
          },
        }),
      ]);
      setEmployees(emps);
      setRows(tx);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriod, employeeId]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const da = new Date(a.transaction_date).getTime();
      const db = new Date(b.transaction_date).getTime();
      return sortDir === 'asc' ? da - db : db - da;
    });
    return copy;
  }, [rows, sortDir]);

  const totals = useMemo(() => {
    const sale = sorted.filter(r => r.transaction_type === 'sale');
    const ret = sorted.filter(r => r.transaction_type === 'return');
    const coll = sorted.filter(r => r.transaction_type === 'collection');
    const sum = (arr) => arr.reduce((s, r) => s + Number(r.amount || 0), 0);
    return {
      count: sorted.length,
      sale_amount: sum(sale),
      return_amount: sum(ret),
      collection_amount: sum(coll),
    };
  }, [sorted]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-neutral-900">Transactions</h1>
        <p className="text-sm text-neutral-500 mt-1">
          View transaction data used for KPI calculations (period: <span className="font-mono">{selectedPeriod}</span>)
        </p>
      </div>

      <div className="card p-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4 flex-wrap">
          <div className="flex-1 min-w-0 sm:min-w-[220px] sm:max-w-sm">
            <label className="label">Employee</label>
            <select className="input" value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
              <option value="">All Employees</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>

          <button
            className="btn-secondary flex items-center gap-2 h-[42px]"
            onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
          >
            <ArrowDownUp className="w-4 h-4" />
            Sort Date: {sortDir.toUpperCase()}
          </button>

          <button className="btn-primary flex items-center gap-2 h-[42px]" onClick={fetchData}>
            <RefreshCcw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="text-xs text-neutral-400 mb-1">Rows</div>
          <div className="text-lg font-bold text-neutral-900">{formatNumber(totals.count)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-neutral-400 mb-1">Sales</div>
          <div className="text-lg font-bold text-neutral-900">{formatCurrency(totals.sale_amount)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-neutral-400 mb-1">Returns</div>
          <div className="text-lg font-bold text-rose-600">-{formatCurrency(totals.return_amount)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-neutral-400 mb-1">Collections</div>
          <div className="text-lg font-bold text-emerald-700">{formatCurrency(totals.collection_amount)}</div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="p-5 border-b border-neutral-200">
          <div className="font-semibold text-neutral-900">Transaction List</div>
          <div className="text-xs text-neutral-500 mt-0.5">Showing up to 500 newest rows for selected filters</div>
        </div>

        {loading ? (
          <div className="h-64 bg-neutral-100 animate-pulse" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50">
                <th className="text-left py-3 px-5 font-medium text-neutral-600">Date</th>
                <th className="text-left py-3 px-4 font-medium text-neutral-600">Employee</th>
                <th className="text-left py-3 px-4 font-medium text-neutral-600">Customer</th>
                <th className="text-left py-3 px-4 font-medium text-neutral-600">Product</th>
                <th className="text-left py-3 px-4 font-medium text-neutral-600">Type</th>
                <th className="text-right py-3 px-4 font-medium text-neutral-600">Qty</th>
                <th className="text-right py-3 px-5 font-medium text-neutral-600">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                  <td className="py-2.5 px-5 text-neutral-700">{formatDate(r.transaction_date)}</td>
                  <td className="py-2.5 px-4 text-neutral-700">{r.employee_name}</td>
                  <td className="py-2.5 px-4 text-neutral-700">{r.customer_name}</td>
                  <td className="py-2.5 px-4 text-neutral-700">
                    <div className="font-medium">{r.product_name}</div>
                    <div className="text-xs text-neutral-400 font-mono">{r.product_sku}</div>
                  </td>
                  <td className="py-2.5 px-4 text-neutral-600 font-mono">{r.transaction_type}</td>
                  <td className="py-2.5 px-4 text-right text-neutral-700 font-mono">{formatNumber(r.quantity)}</td>
                  <td className="py-2.5 px-5 text-right font-semibold text-neutral-900">{formatCurrency(r.amount)}</td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-neutral-500">
                    No transactions found for selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

