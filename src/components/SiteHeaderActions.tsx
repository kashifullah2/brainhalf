import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight, ChevronDown, LayoutDashboard, LogOut } from 'lucide-react';
import { getToken, getUser, logout } from '../lib/auth-client';
import ThemeToggle from './ThemeToggle';
import './LandingPage.css';

export interface HeaderUser {
  id?: string;
  email?: string;
  name?: string;
}

interface SiteHeaderActionsProps {
  currentUser?: HeaderUser | null;
  onLogout?: () => void | Promise<void>;
  onOpenDashboard?: () => void;
  onAuthRequest?: (mode: 'login' | 'signup') => void;
  hideDashboard?: boolean;
  menuExtra?: ReactNode;
  startHref?: string;
}

export default function SiteHeaderActions({
  currentUser,
  onLogout,
  onOpenDashboard,
  onAuthRequest,
  hideDashboard = false,
  menuExtra,
  startHref = '/#start-building',
}: SiteHeaderActionsProps) {
  const controlled = currentUser !== undefined;
  const [mounted, setMounted] = useState(false);
  const [detectedUser, setDetectedUser] = useState<HeaderUser | null>(null);
  useEffect(() => {
    setMounted(true);
    if (!controlled) setDetectedUser(getToken() ? getUser() : null);
  }, [controlled]);

  const user = controlled ? currentUser : mounted ? detectedUser : null;
  const showAuthControls = controlled || mounted;

  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const userMenuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setShowUserMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!showUserMenu) return;
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setShowUserMenu(false);
      userMenuButtonRef.current?.focus();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [showUserMenu]);

  const handleLogout = () => {
    setShowUserMenu(false);
    if (onLogout) {
      void onLogout();
      return;
    }
    void logout().finally(() => window.location.assign('/'));
  };

  const userInitial = (user?.name || user?.email || 'U').trim()[0].toUpperCase();

  const dashboardControl = hideDashboard ? null : onOpenDashboard ? (
    <button type="button" className="landing-get-started-btn landing-dashboard-btn" onClick={onOpenDashboard}>
      <LayoutDashboard size={14} aria-hidden="true" /> Dashboard
    </button>
  ) : (
    <a className="landing-get-started-btn landing-dashboard-btn" href="/dashboard">
      <LayoutDashboard size={14} aria-hidden="true" /> Dashboard
    </a>
  );

  return (
    <>
      {showAuthControls && user && dashboardControl}
      <ThemeToggle />
      {!showAuthControls || user ? null : onAuthRequest ? (
        <div className="landing-auth-buttons">
          <button type="button" className="landing-signin-btn" onClick={() => onAuthRequest('login')}>Sign in</button>
          <button type="button" className="landing-get-started-btn" onClick={() => onAuthRequest('signup')}>
            <span>Get Started</span>
            <ArrowRight size={13} />
          </button>
        </div>
      ) : (
        <a className="landing-get-started-btn" href={startHref}>Start building <ArrowRight size={14} /></a>
      )}
      {showAuthControls && user && (
        <div className="landing-user-menu-anchor" ref={userMenuRef}>
          <button
            ref={userMenuButtonRef}
            type="button"
            className="landing-user-menu-trigger"
            onClick={() => setShowUserMenu(previous => !previous)}
            title={user.email || 'User Profile'}
            aria-label="User profile and menu"
            aria-haspopup="menu"
            aria-expanded={showUserMenu}
          >
            <span className="landing-user-avatar" aria-hidden="true">{userInitial}</span>
            <ChevronDown size={13} className="landing-user-menu-chevron" aria-hidden="true" />
          </button>
          {showUserMenu && (
            <div className="landing-user-dropdown" role="menu" aria-label="User menu">
              <div className="landing-user-dropdown-info" role="presentation">
                <p className="user-email">{user.email || 'Your account'}</p>
                {menuExtra}
              </div>
              <hr className="landing-dropdown-divider" />
              {!hideDashboard && (
                <a
                  className="landing-dropdown-item"
                  role="menuitem"
                  href="/dashboard"
                  onClick={event => {
                    if (!onOpenDashboard) return;
                    event.preventDefault();
                    setShowUserMenu(false);
                    onOpenDashboard();
                  }}
                >
                  <LayoutDashboard size={14} />
                  <span>Dashboard</span>
                </a>
              )}
              <button type="button" className="landing-dropdown-item" role="menuitem" onClick={handleLogout}>
                <LogOut size={14} />
                <span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
