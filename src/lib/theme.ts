import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'brainhalf_theme';
const EVENT = 'brainhalf-theme-change';

function savedTheme(): Theme | null {
  try { const value = localStorage.getItem(KEY); return value === 'dark' || value === 'light' ? value : null; } catch { return null; }
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d1219' : '#f8f9fc');
  window.dispatchEvent(new Event(EVENT));
}

export function setTheme(theme: Theme) {
  try { localStorage.setItem(KEY, theme); } catch {}
  applyTheme(theme);
}

function subscribe(listener: () => void) {
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => applyTheme(savedTheme() || (system.matches ? 'dark' : 'light'));
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) update(); };
  window.addEventListener(EVENT, listener);
  window.addEventListener('storage', storage);
  system.addEventListener('change', update);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener('storage', storage);
    system.removeEventListener('change', update);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', () => 'light');
}
