import { NavLink, useLocation } from 'react-router-dom';
import { useAppStore } from '../../store/store';
import {
  LayoutDashboard,
  FileText,
  Target,
  Calculator,
  FlaskConical,
  CheckCircle2,
  ScrollText,
  Users,
  ChevronLeft,
  ChevronRight,
  Banknote,
  X,
} from 'lucide-react';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/plans', icon: FileText, label: 'Plans' },
  { to: '/kpis', icon: Target, label: 'KPI Library' },
  { to: '/calculate', icon: Calculator, label: 'Calculate' },
  { to: '/simulate', icon: FlaskConical, label: 'Simulate' },
  { to: '/approvals', icon: CheckCircle2, label: 'Approvals' },
  { to: '/audit', icon: ScrollText, label: 'Audit Trail' },
  { to: '/employees', icon: Users, label: 'Employees' },
];

export default function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, mobileMenuOpen, setMobileMenuOpen } = useAppStore();
  const location = useLocation();

  const navContent = (mobile = false) => (
    <>
      <div className="h-16 flex items-center px-4 border-b border-slate-700">
        <Banknote className="w-8 h-8 text-primary-400 flex-shrink-0" />
        {(mobile || !sidebarCollapsed) && (
          <div className="ml-3">
            <span className="text-[11px] font-medium text-slate-400 tracking-wider block leading-tight">WINIT</span>
            <span className="text-base font-semibold tracking-tight leading-tight">CommissionIQ</span>
          </div>
        )}
        {mobile && (
          <button onClick={() => setMobileMenuOpen(false)} className="ml-auto text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
      <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => mobile && setMobileMenuOpen(false)}
            title={!mobile && sidebarCollapsed ? item.label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              } ${!mobile && sidebarCollapsed ? 'justify-center' : ''}`
            }
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            {(mobile || !sidebarCollapsed) && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`${
          sidebarCollapsed ? 'w-16' : 'w-60'
        } bg-slate-900 text-white hidden md:flex flex-col transition-all duration-200 ease-in-out flex-shrink-0`}
      >
        {navContent(false)}
        <button
          onClick={toggleSidebar}
          className="h-12 flex items-center justify-center border-t border-slate-700 text-slate-400 hover:text-white transition-colors"
        >
          {sidebarCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </aside>

      {/* Mobile overlay sidebar */}
      {mobileMenuOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setMobileMenuOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-64 bg-slate-900 text-white flex flex-col z-50 md:hidden">
            {navContent(true)}
          </aside>
        </>
      )}
    </>
  );
}
