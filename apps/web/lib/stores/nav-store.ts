import { create } from 'zustand';

interface NavState {
  isSidebarCollapsed: boolean;
  currentRoute: string;
  activeProject: { id: string; name: string } | null;
  theme: 'dark' | 'light' | 'system';
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setCurrentRoute: (route: string) => void;
  setActiveProject: (project: { id: string; name: string } | null) => void;
  setTheme: (theme: 'dark' | 'light' | 'system') => void;
}

export const useNavStore = create<NavState>((set) => ({
  isSidebarCollapsed: false,
  currentRoute: '/',
  activeProject: null,
  theme: 'dark',
  setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed }),
  toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
  setCurrentRoute: (route) => set({ currentRoute: route }),
  setActiveProject: (project) => set({ activeProject: project }),
  setTheme: (theme) => set({ theme }),
}));
