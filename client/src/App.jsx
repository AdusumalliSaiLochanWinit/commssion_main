import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import DashboardPage from './pages/DashboardPage';
import PlanListPage from './pages/PlanListPage';
import PlanBuilderPage from './pages/PlanBuilderPage';
import KpiLibraryPage from './pages/KpiLibraryPage';
import CalculationPage from './pages/CalculationPage';
import SimulationPage from './pages/SimulationPage';
import ApprovalsPage from './pages/ApprovalsPage';
import AuditTrailPage from './pages/AuditTrailPage';
import EmployeesPage from './pages/EmployeesPage';

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-3 md:p-6 bg-slate-50">
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
          </Routes>
        </main>
      </div>
    </div>
  );
}
