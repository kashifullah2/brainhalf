import { Moon, Sun } from 'lucide-react';
import { setTheme, useTheme } from '../lib/theme';

export default function ThemeToggle() {
  const theme = useTheme();
  const label = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  return <button type="button" className="studio-theme-toggle" aria-label={label} title={label}
    onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
    {theme === 'light' ? <Moon size={17} /> : <Sun size={18} />}
  </button>;
}
