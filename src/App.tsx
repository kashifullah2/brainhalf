import React, { useState, useEffect } from 'react';
import TopNav from './components/TopNav';
import ChatPanel from './components/ChatPanel';
import Workspace from './components/Workspace';
import LoginScreen from './components/LoginScreen';
import { BrainHalfLogo } from './components/BrainHalfLogo';
import { getActiveProjectId, setActiveProjectId } from './lib/project-store';
import { getToken, getUser, logout, verifyStoredSession, type SessionUser } from './lib/auth-client';
import './index.css';

function App() {
  // No session is rendered until the server confirms the token is valid
  // (signature + expiry + revocation). Fail closed on the client too.
  const [user, setUser] = useState<SessionUser | null>(() => (getToken() ? getUser() : null));
  const [authChecked, setAuthChecked] = useState<boolean>(!getToken());

  useEffect(() => {
    if (!getToken()) {
      setUser(null);
      setAuthChecked(true);
      return;
    }
    let mounted = true;
    verifyStoredSession().then((verified) => {
      if (!mounted) return;
      setUser(verified);
      setAuthChecked(true);
    });
    // Another tab logged out, or the server rejected a stored token.
    const onExpired = () => {
      setUser(null);
      setAuthChecked(true);
    };
    window.addEventListener('bh-session-expired', onExpired);
    return () => {
      mounted = false;
      window.removeEventListener('bh-session-expired', onExpired);
    };
  }, []);

  const [activeProjectId, setActiveId] = useState<string>(getActiveProjectId());
  const [mobileTab, setMobileTab] = useState<'chat' | 'code' | 'preview'>('chat');
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth <= 768;
    }
    return false;
  });

  const [chatWidth, setChatWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      return Math.min(460, Math.max(380, Math.floor(window.innerWidth * 0.3)));
    }
    return 400;
  });
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const isDraggingRef = React.useRef(false);

  // Update mobile view state on window resize
  React.useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Listen to popstate event for browser back/forward URL navigation
  React.useEffect(() => {
    const handlePopState = () => {
      const currentId = getActiveProjectId();
      setActiveId(currentId);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleSelectProject = (id: string) => {
    if (!id) return;
    setActiveProjectId(id);
    setActiveId(id);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.classList.add('is-resizing');

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const calculatedWidth = moveEvent.clientX;
      const clampedWidth = Math.min(Math.max(calculatedWidth, 360), Math.min(window.innerWidth - 500, 720));
      setChatWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.classList.remove('is-resizing');
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleDoubleClickDivider = () => {
    setChatWidth(440);
  };

  // The server revokes the token; we drop the local copy regardless so the UI
  // never lingers on a session the server has already invalidated.
  const handleLogout = async () => {
    await logout();
    setUser(null);
  };

  if (!authChecked) {
    return (
      <div
        className="app-container"
        style={{ display: 'grid', placeItems: 'center', background: '#0b0c11' }}
        aria-busy="true"
        aria-label="Verifying session"
      >
        <BrainHalfLogo size={28} strokeWidth={1.5} color="#2dd4bf" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onAuthenticated={setUser} />;
  }

  return (
    <div className="app-container">
      <div className="main-content">
        <TopNav
          activeProjectId={activeProjectId}
          onSelectProject={handleSelectProject}
          mobileTab={mobileTab}
          onSelectMobileTab={setMobileTab}
          isMobile={isMobile}
          currentUser={user}
          onLogout={handleLogout}
        />
        <div className={`workspace-area ${isMobile ? 'is-mobile' : ''}`}>
          {(!isMobile || mobileTab === 'chat') && (
            <ChatPanel key={`chat-${activeProjectId}`} activeProjectId={activeProjectId} width={isMobile ? undefined : chatWidth} />
          )}
          {!isMobile && (
            <div 
              className={`panel-resize-handle ${isResizing ? 'active' : ''}`}
              onMouseDown={handleMouseDown}
              onDoubleClick={handleDoubleClickDivider}
              title="Drag to resize panels (Double-click to reset)"
            />
          )}
          {(!isMobile || mobileTab === 'code' || mobileTab === 'preview') && (
            <Workspace key={`workspace-${activeProjectId}`} activeProjectId={activeProjectId} mobileTab={isMobile ? mobileTab : undefined} />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
