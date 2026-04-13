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
      <div className={`flex items-center border-b border-neutral-200 ${
        (mobile || !sidebarCollapsed) ? 'flex-col py-3 px-4' : 'h-16 justify-center'
      }`}>
        {(mobile || !sidebarCollapsed) ? (
          <>
            <img
              src="/app-logo.svg"
              alt="Dubai Refreshment Logo"
              style={{ width: '100%', maxHeight: '48px', objectFit: 'contain' }}
            />
            <span className="mt-1.5 text-sm font-semibold tracking-tight text-neutral-800">CommissionIQ</span>
            {mobile && (
              <button onClick={() => setMobileMenuOpen(false)} className="absolute top-3 right-3 text-neutral-400 hover:text-neutral-700">
                <X className="w-5 h-5" />
              </button>
            )}
          </>
        ) : (
          <Banknote className="w-7 h-7 text-primary-600 flex-shrink-0" />
        )}
      </div>
      <nav className="flex-1 py-4 space-y-0.5 px-2 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => mobile && setMobileMenuOpen(false)}
            title={!mobile && sidebarCollapsed ? item.label : undefined}
            className={({ isActive }) =>
              `relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900'
              } ${!mobile && sidebarCollapsed ? 'justify-center' : ''}`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && !sidebarCollapsed && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-[70%] w-[2px] rounded-full"
                    style={{
                      background:
                        'linear-gradient(to bottom, transparent, rgb(0,75,147), transparent)',
                    }}
                  />
                )}
                <item.icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-primary-600' : ''}`} />
                {(mobile || !sidebarCollapsed) && <span>{item.label}</span>}
              </>
            )}
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
        } bg-white text-neutral-700 border-r border-neutral-200 hidden md:flex flex-col transition-all duration-200 ease-in-out flex-shrink-0`}
      >
        {navContent(false)}
        <button
          onClick={toggleSidebar}
          className="h-12 flex items-center justify-center border-t border-neutral-200 text-neutral-400 hover:text-neutral-700 transition-colors"
        >
          {sidebarCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </aside>

      {/* Mobile overlay sidebar */}
      {mobileMenuOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setMobileMenuOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-64 bg-white text-neutral-700 border-r border-neutral-200 flex flex-col z-50 md:hidden">
            {navContent(true)}
          </aside>
        </>
      )}
    </>
  );
}
