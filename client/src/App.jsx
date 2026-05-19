import { lazy, Suspense, Component } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';

// Catches chunk-load failures (network blip, stale deploy after cache eviction)
// and offers a recovery action instead of a blank screen. Without this, a
// failed dynamic import() leaves Suspense hanging forever.
class ChunkErrorBoundary extends Component {
  state = { err: null };
  static getDerivedStateFromError(err) {
    // Detect chunk-load specifically; let other errors bubble.
    const msg = String(err?.message || err);
    if (/Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg)) {
      return { err };
    }
    return { err };
  }
  componentDidCatch(err) {
    console.error('[ChunkErrorBoundary]', err);
  }
  render() {
    if (this.state.err) {
      const isChunkErr = /Loading chunk|dynamically imported module|module script failed/i.test(String(this.state.err.message || ''));
      return (
        <div className="h-full w-full flex items-center justify-center p-6">
          <div className="max-w-md text-center space-y-4">
            <div className="text-neutral-900 text-lg font-semibold">
              {isChunkErr ? 'Page failed to load' : 'Something went wrong'}
            </div>
            <p className="text-sm text-neutral-500">
              {isChunkErr
                ? 'A new version may have just been deployed. Reloading should fix this.'
                : String(this.state.err.message || this.state.err)}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm hover:bg-primary-700"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Route-level code splitting: each page is its own JS chunk loaded on demand.
// Cuts initial bundle from ~850 KB to ~150 KB; each subsequent page loads its
// own chunk (10-80 KB) and React caches it for the rest of the session.
const DashboardPage    = lazy(() => import('./pages/DashboardPage'));
const PlanListPage     = lazy(() => import('./pages/PlanListPage'));
const PlanBuilderPage  = lazy(() => import('./pages/PlanBuilderPage'));
const KpiLibraryPage   = lazy(() => import('./pages/KpiLibraryPage'));
const CalculationPage  = lazy(() => import('./pages/CalculationPage'));
const SimulationPage   = lazy(() => import('./pages/SimulationPage'));
const ApprovalsPage    = lazy(() => import('./pages/ApprovalsPage'));
const AuditTrailPage   = lazy(() => import('./pages/AuditTrailPage'));
const EmployeesPage    = lazy(() => import('./pages/EmployeesPage'));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));

function PageLoader() {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-neutral-500">
        <div className="w-7 h-7 rounded-full border-[3px] border-neutral-200 border-t-primary-600 animate-spin" />
        <span className="text-xs">Loading…</span>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-3 md:p-6 bg-neutral-50">
         <ChunkErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/plans" element={<PlanListPage />} />
              <Route path="/plans/:id" element={<PlanBuilderPage />} />
              <Route path="/plans/new" element={<PlanBuilderPage />} />
              <Route path="/kpis" element={<KpiLibraryPage />} />
              <Route path="/calculate" element={<CalculationPage />} />
              <Route path="/simulate" element={<SimulationPage />} />
              <Route path="/approvals" element={<ApprovalsPage />} />
              <Route path="/audit" element={<AuditTrailPage />} />
              <Route path="/employees" element={<EmployeesPage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
            </Routes>
          </Suspense>
         </ChunkErrorBoundary>
        </main>
      </div>
    </div>
  );
}
