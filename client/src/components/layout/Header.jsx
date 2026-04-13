import { useState } from 'react';
import { useAppStore } from '../../store/store';
import { ChevronDown, Calendar, Menu } from 'lucide-react';

const personas = [
  { id: 'admin', name: 'Admin', role: 'Administrator', roleId: 'role-nsm' },
  { id: 'emp-43026442', name: 'Abdul Rehman', role: 'Sales Representative', roleId: 'role-sr' },
  { id: 'emp-43025945', name: 'Naeem Shahzad', role: 'Sales Representative', roleId: 'role-sr' },
  { id: 'emp-43026096', name: 'Dinoop Nellulliyil', role: 'Sales Representative', roleId: 'role-sr' },
  { id: 'emp-ss-9105', name: 'Khalid Ibrahim', role: 'Sales Supervisor', roleId: 'role-ss' },
  { id: 'emp-asm-dubai', name: 'Faisal Hassan', role: 'Area Sales Manager', roleId: 'role-asm' },
  { id: 'emp-rsm-dubai', name: 'Omar Khalil', role: 'Regional Sales Manager', roleId: 'role-rsm' },
  { id: 'emp-nsm-1', name: 'Ahmad Al Rashid', role: 'National Sales Manager', roleId: 'role-nsm' },
  { id: 'emp-kam-1', name: 'Layla Mahmoud', role: 'Key Account Manager', roleId: 'role-kam' },
];

// Quick-select shortcuts shown alongside the calendar picker
const QUICK_PERIODS = [
  { value: 'current', label: 'This Month' },
  { value: 'previous', label: 'Last Month' },
  { value: '2026-Q1', label: 'Q1 2026' },
  { value: '2025-Q4', label: 'Q4 2025' },
];

function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function getPreviousMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function formatPeriodLabel(period) {
  if (!period) return '';
  if (period.includes('Q')) return period.replace('-', ' ');
  const [y, m] = period.split('-');
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function Header() {
  const { currentPersona, setPersona, selectedPeriod, setSelectedPeriod, toggleMobileMenu, sidebarCollapsed } = useAppStore();
  const [personaOpen, setPersonaOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);

  const handleQuickSelect = (val) => {
    if (val === 'current') setSelectedPeriod(getCurrentMonth());
    else if (val === 'previous') setSelectedPeriod(getPreviousMonth());
    else setSelectedPeriod(val);
    setPeriodOpen(false);
  };

  const handleMonthChange = (e) => {
    if (e.target.value) {
      setSelectedPeriod(e.target.value);
      setPeriodOpen(false);
    }
  };

  return (
    <header className="h-14 md:h-16 bg-white border-b border-neutral-200 flex items-center justify-between px-3 md:px-6 flex-shrink-0">
      <div className="flex items-center gap-2">
        {/* Mobile hamburger */}
        <button onClick={toggleMobileMenu} className="md:hidden p-1.5 -ml-1 rounded-lg text-neutral-600 hover:bg-neutral-100">
          <Menu className="w-5 h-5" />
        </button>
        {sidebarCollapsed && (
          <img
            src="/app-logo.svg"
            alt="Dubai Refreshment"
            className="hidden md:block mr-2"
            style={{ height: '32px', width: 'auto', objectFit: 'contain' }}
          />
        )}
        <div className="flex items-center gap-2 text-sm text-neutral-500">
          <span className="font-medium text-neutral-800">Dubai Refreshment</span>
          <span className="hidden sm:inline">/</span>
          <span className="hidden sm:inline">CommissionIQ</span>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-4">
        {/* Period selector — calendar + quick presets */}
        <div className="relative">
          <button
            onClick={() => setPeriodOpen(!periodOpen)}
            className="flex items-center gap-1.5 md:gap-2 text-xs md:text-sm border border-neutral-200 rounded-lg px-2 md:px-3 py-1.5 bg-white hover:bg-neutral-50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-600"
          >
            <Calendar className="w-4 h-4 text-neutral-500" />
            <span className="font-medium text-neutral-700">{formatPeriodLabel(selectedPeriod)}</span>
            <ChevronDown className="w-4 h-4 text-neutral-400" />
          </button>

          {periodOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPeriodOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-72 bg-white rounded-lg shadow-lg border border-neutral-200 p-3 z-20">
                <div className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-2">
                  Pick a Month
                </div>
                <input
                  type="month"
                  value={selectedPeriod.includes('Q') ? '' : selectedPeriod}
                  onChange={handleMonthChange}
                  max="2030-12"
                  min="2020-01"
                  className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-primary-600"
                />
                <div className="text-xs font-medium text-neutral-400 uppercase tracking-wider mb-2">
                  Quick Select
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {QUICK_PERIODS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => handleQuickSelect(p.value)}
                      className="px-3 py-2 text-xs font-medium rounded-lg bg-neutral-50 hover:bg-primary-50 hover:text-primary-700 text-neutral-600 transition-colors"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-neutral-100 text-xs text-neutral-500">
                  Active: <span className="font-medium text-neutral-700">{formatPeriodLabel(selectedPeriod)}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Persona switcher */}
        <div className="relative">
          <button
            onClick={() => setPersonaOpen(!personaOpen)}
            className="flex items-center gap-2 md:gap-3 px-2 md:px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 transition-colors"
          >
            <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-primary-50 text-primary-700 flex items-center justify-center text-xs md:text-sm font-semibold">
              {currentPersona.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div className="text-left hidden sm:block">
              <div className="text-sm font-medium text-neutral-800">{currentPersona.name}</div>
              <div className="text-xs text-neutral-500">{currentPersona.role}</div>
            </div>
            <ChevronDown className="w-4 h-4 text-neutral-400" />
          </button>

          {personaOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPersonaOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-64 md:w-72 bg-white rounded-lg shadow-lg border border-neutral-200 py-2 z-20 max-h-[70vh] overflow-y-auto">
                <div className="px-3 py-2 text-xs font-medium text-neutral-400 uppercase tracking-wider">
                  Switch Persona
                </div>
                {personas.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setPersona(p); setPersonaOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2 hover:bg-neutral-50 transition-colors ${
                      currentPersona.id === p.id ? 'bg-primary-50' : ''
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full bg-primary-50 text-primary-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                      {p.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div className="text-left">
                      <div className="text-sm font-medium text-neutral-800">{p.name}</div>
                      <div className="text-xs text-neutral-500">{p.role}</div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
