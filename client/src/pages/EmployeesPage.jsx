import { useState, useEffect } from 'react';
import api from '../api/client';
import { Users, Building2, User, ChevronRight, AlertCircle } from 'lucide-react';
import { formatCurrency, cn } from '../lib/utils';

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedEmployee, setSelectedEmployee] = useState(null);

  useEffect(() => {
    api.get('/employees')
      .then(setEmployees)
      .catch(() => setError('Failed to load employees'))
      .finally(() => setLoading(false));
  }, []);

  const roleGroups = employees.reduce((acc, emp) => {
    const key = emp.role_name;
    if (!acc[key]) acc[key] = [];
    acc[key].push(emp);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-slate-200 rounded animate-pulse" />
        {[1,2,3,4,5].map(i => (
          <div key={i} className="card p-4">
            <div className="h-5 w-48 bg-slate-200 rounded animate-pulse mb-2" />
            <div className="h-4 w-32 bg-slate-100 rounded animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-12 text-center">
        <AlertCircle className="w-12 h-12 text-rose-300 mx-auto mb-3" />
        <h3 className="text-lg font-medium text-slate-700 mb-1">Failed to Load Employees</h3>
        <p className="text-slate-500 mb-4">{error}</p>
        <button onClick={() => window.location.reload()} className="btn-primary">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Employees</h1>
        <p className="text-slate-500 mt-1">{employees.length} employees across {Object.keys(roleGroups).length} roles</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Employee List */}
        <div className="lg:col-span-2 space-y-4">
          {Object.entries(roleGroups)
            .sort(([,a], [,b]) => (b[0]?.role_level || 0) - (a[0]?.role_level || 0))
            .map(([role, emps]) => (
            <div key={role} className="card">
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 rounded-t-xl">
                <h3 className="text-sm font-semibold text-slate-700">{role} ({emps.length})</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {emps.map(emp => (
                  <button
                    key={emp.id}
                    onClick={() => setSelectedEmployee(emp)}
                    className={cn(
                      'w-full flex items-center gap-4 px-5 py-3 hover:bg-slate-50 transition-colors text-left',
                      selectedEmployee?.id === emp.id && 'bg-primary-50'
                    )}
                  >
                    <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-semibold flex-shrink-0">
                      {emp.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-900">{emp.name}</div>
                      <div className="text-xs text-slate-500">{emp.email}</div>
                    </div>
                    <div className="text-right text-sm">
                      <div className="text-slate-600">{emp.territory_name || 'N/A'}</div>
                      <div className="text-xs text-slate-400">{formatCurrency(emp.base_salary)}/mo</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-1">
          {selectedEmployee ? (
            <div className="card p-5 md:sticky md:top-6 space-y-4">
              <div className="text-center pb-4 border-b border-slate-100">
                <div className="w-16 h-16 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xl font-semibold mx-auto mb-3">
                  {selectedEmployee.name.split(' ').map(n => n[0]).join('')}
                </div>
                <h3 className="text-lg font-semibold text-slate-900">{selectedEmployee.name}</h3>
                <p className="text-sm text-slate-500">{selectedEmployee.role_name}</p>
              </div>

              <div className="space-y-3">
                <DetailRow label="Email" value={selectedEmployee.email} />
                <DetailRow label="Territory" value={selectedEmployee.territory_name || 'National'} />
                <DetailRow label="Base Salary" value={formatCurrency(selectedEmployee.base_salary)} />
                <DetailRow label="Reports To" value={selectedEmployee.manager_name || 'None'} />
                <DetailRow label="Hire Date" value={selectedEmployee.hire_date} />
                <DetailRow label="Status" value={selectedEmployee.is_active ? 'Active' : 'Inactive'} />
              </div>
            </div>
          ) : (
            <div className="card p-8 text-center">
              <User className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">Select an employee to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-900">{value}</span>
    </div>
  );
}
