import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { setTheme, useTheme } from '../lib/theme';

export default function ThemeToggle() {
  const theme = useTheme();
  // theme-init.js sets data-theme="dark" before React hydrates for dark-mode
  // users, but the prerendered HTML always assumes the light theme (the server
  // snapshot is 'light'). Rendering the theme-dependent icon/label on the
  // first pass would produce a React #418 hydration mismatch, so the initial
  // render always matches the prerender and the real theme applies after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const effective = mounted ? theme : 'light';
  const label = effective === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  return <button type="button" className="studio-theme-toggle" aria-label={label} title={label}
    onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
    {effective === 'light' ? <Moon size={17} /> : <Sun size={18} />}
  </button>;
}
