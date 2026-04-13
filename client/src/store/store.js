import { create } from 'zustand';

export const useAppStore = create((set, get) => ({
  // Current persona for role-based views
  currentPersona: {
    id: 'admin',
    name: 'Admin',
    role: 'Administrator',
    roleId: 'role-nsm',
  },
  setPersona: (persona) => set({ currentPersona: persona }),

  // Period selector
  selectedPeriod: '2026-01',
  setSelectedPeriod: (period) => set({ selectedPeriod: period }),

  // Sidebar state
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  // Mobile menu
  mobileMenuOpen: false,
  setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
  toggleMobileMenu: () => set((s) => ({ mobileMenuOpen: !s.mobileMenuOpen })),

  // Employees list (cached)
  employees: [],
  setEmployees: (employees) => set({ employees }),
}));
