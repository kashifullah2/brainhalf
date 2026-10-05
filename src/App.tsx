import './styles/studio-workspace.css';
import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Bot, Code2, GripVertical, Monitor } from 'lucide-react';
import LandingPage from './components/landing/LandingPage';
import LoginScreen from './components/LoginScreen';
import { ErrorBoundary, SectionErrorBoundary } from './components/ErrorBoundary';
import { WORKSPACE_EXIT_TIMEOUT, WORKSPACE_EXIT_ATTEMPTS } from './lib/timeouts';

const ChatPanel = lazy(() => import('./components/ChatPanel'));
const Workspace = lazy(() => import('./components/Workspace'));
const DashboardPage = lazy(() => import('./components/DashboardPage'));
import { BrainHalfLogo } from './components/BrainHalfLogo';
import ConfirmModal from './components/ConfirmModal';
import { appEvents } from './lib/events';
import { getActiveProjectId, setActiveProjectId, createProject, setProjectSubmissionKey, shortTitleFromPrompt } from './lib/project-store';
import { setOnboardingState } from './lib/project-growth';
import { authFetch, clearGoogleCompletion, completeGoogleSignIn, detachSession, getToken, logout, prefetchWsTicket, purgeEmptyDrafts, saveGooglePrompt, takeGooglePrompt, verifyStoredSession, type SessionUser } from './lib/auth-client';
import { runtimeBase } from './lib/project-runtime-client';
import './index.css';
import { isPrivateSearch, pageMetadata } from './seo/metadata';

function panelLimits(width: number) {
  const maximum = Math.max(240, Math.min(width - 500, 720));
  return { minimum: Math.min(360, maximum), maximum };
}

function App() {
  // No session is rendered until the server confirms the token is valid
  // (signature + expiry + revocation). Fail closed on the client too.
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authChecked, setAuthChecked] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('google')) return false;
    // If a token exists, always wait for server verification to avoid
    // a flash of the unauthenticated landing page.
    if (getToken()) return false;
    return true;
  });
  const [authError, setAuthError] = useState<string | null>(null);
  const [activeProjectId, setActiveId] = useState<string>(getActiveProjectId());
  const [currentView, setCurrentView] = useState<'landing' | 'dashboard' | 'workspace'>(() => {
    if (typeof window !== 'undefined' && window.location?.search) {
      const projectId = new URLSearchParams(window.location.search).get('project');
      if (projectId) return 'workspace';
    }
    return typeof window !== 'undefined' && window.location.pathname === '/dashboard' ? 'dashboard' : 'landing';
  });
  useEffect(() => {
    const robots = document.querySelector('meta[name="robots"]');
    const privateView = currentView === 'workspace' || currentView === 'dashboard' || isPrivateSearch(window.location.search);
    robots?.setAttribute('content', privateView ? 'noindex, nofollow' : pageMetadata('/').robots);
    document.title = currentView === 'dashboard' ? 'Projects Dashboard | BrainHalf' : currentView === 'workspace' ? 'Project Workspace | BrainHalf' : pageMetadata('/').title;
  }, [currentView, activeProjectId]);
  const [pendingInitialPrompt, setPendingInitialPrompt] = useState<{ projectId: string; prompt: string } | null>(null);
  const pendingPromptRef = React.useRef<{ prompt: string } | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [pendingProjectClaimId, setPendingProjectClaimId] = useState<string | null>(null);
  const createProjectLockedRef = useRef(false);
  const createProjectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [generationActive, setGenerationActive] = useState(false);
  const [runtimeActive, setRuntimeActive] = useState(false);
  const [closingProject, setClosingProject] = useState(false);
  const [closeError, setCloseError] = useState('');
  const [pendingWorkspaceExit, setPendingWorkspaceExit] = useState<'home' | 'new' | 'dashboard' | null>(null);

  const releaseProjectCreationLock = React.useCallback(() => {
    createProjectLockedRef.current = false;
    setCreatingProject(false);
    setPendingProjectClaimId(null);
    if (createProjectTimeoutRef.current) {
      clearTimeout(createProjectTimeoutRef.current);
      createProjectTimeoutRef.current = null;
    }
  }, []);

  const markProjectCreationPending = React.useCallback((projectId: string, submissionKey: string) => {
    setProjectSubmissionKey(projectId, submissionKey);
    setPendingProjectClaimId(projectId);
    setCreatingProject(true);
    createProjectLockedRef.current = true;
    if (createProjectTimeoutRef.current) clearTimeout(createProjectTimeoutRef.current);
    createProjectTimeoutRef.current = setTimeout(() => {
      releaseProjectCreationLock();
    }, 20_000);
  }, [releaseProjectCreationLock]);

  useEffect(() => {
    let mounted = true;
    let attempt = 0;
    const verify = async () => {
      const current = ++attempt;
      const google = completeGoogleSignIn();
      if (google) {
        try {
          const verified = await google;
          if (!mounted || current !== attempt) return;
          pendingPromptRef.current = takeGooglePrompt();
          handleAuthenticated(verified);
        } catch (error) {
          if (!mounted || current !== attempt) return;
          pendingPromptRef.current = takeGooglePrompt();
          setAuthError(error instanceof Error ? error.message : 'Google sign-in could not finish. Try again.');
          setAuthModal({ isOpen: true, mode: 'login' });
        }
        if (mounted && current === attempt) { clearGoogleCompletion(); setAuthChecked(true); }
        return;
      }
      const verified = await verifyStoredSession();
      if (!mounted || current !== attempt) return;
      setUser(verified);
      setActiveId(getActiveProjectId());
      setAuthChecked(true);
    };
    void verify();
    // Another tab logged out, or the server rejected a stored token.
    const onExpired = () => {
      attempt += 1;
      setUser(null);
      setAuthChecked(true);
      setPendingInitialPrompt(null);
      pendingPromptRef.current = null;
      setActiveId('');
      setCurrentView('landing');
      const url = new URL(window.location.href);
      url.searchParams.delete('project');
      url.pathname = '/';
      window.history.replaceState({}, '', url.toString());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== 'bh_session_token' && event.key !== 'bh_session_user') return;
      detachSession();
      onExpired();
      if (getToken()) {
        setAuthChecked(false);
        void verify();
      }
    };
    window.addEventListener('bh-session-expired', onExpired);
    window.addEventListener('storage', onStorage);
    return () => {
      mounted = false;
      window.removeEventListener('bh-session-expired', onExpired);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const activeIdRef = useRef(activeProjectId);
  useEffect(() => {
    activeIdRef.current = activeProjectId;
    setRuntimeActive(false);
  }, [activeProjectId]);

  useEffect(() => appEvents.on('generation-status', ({ status, projectId }) => {
    if (projectId && projectId !== activeIdRef.current) return;
    setGenerationActive(status === 'Generating' || status === 'Building');
  }), []);
  useEffect(() => appEvents.on('runtime-status', ({ projectId, running }) => {
    if (projectId === activeIdRef.current) setRuntimeActive(running);
  }), []);

  useEffect(() => {
    const unsubReady = appEvents.on('workspace-session-ready', ({ projectId }) => {
      if (projectId === pendingProjectClaimId) releaseProjectCreationLock();
    });
    const unsubStatus = appEvents.on('generation-status', ({ projectId, status }) => {
      const matchesPending = projectId ? projectId === pendingProjectClaimId : pendingProjectClaimId === activeIdRef.current;
      if (matchesPending && (status === 'Error' || status === 'Failed')) {
        releaseProjectCreationLock();
      }
    });
    return () => {
      unsubReady();
      unsubStatus();
    };
  }, [pendingProjectClaimId, releaseProjectCreationLock]);

  useEffect(() => () => {
    if (createProjectTimeoutRef.current) clearTimeout(createProjectTimeoutRef.current);
  }, []);

  useEffect(() => {
    if ((!generationActive && !runtimeActive) || currentView !== 'workspace') return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [generationActive, runtimeActive, currentView]);

  useEffect(() => {
    const handleProjectSwitched = (data: { projectId: string }) => {
      if (data.projectId && data.projectId !== activeIdRef.current) {
        setActiveProjectId(data.projectId);
        setActiveId(data.projectId);
      }
    };
    appEvents.on('project-switched', handleProjectSwitched);
    return () => {
      appEvents.off('project-switched', handleProjectSwitched);
    };
  }, []);

  const [mobileTab, setMobileTab] = useState<'chat' | 'code' | 'preview' | 'console' | 'logs' | 'terminal'>('chat');
  const [viewportWidth, setViewportWidth] = useState(() => typeof window === 'undefined' ? 1280 : window.innerWidth);
  const isMobile = viewportWidth <= 768;
  const { minimum: minimumChatWidth, maximum: maximumChatWidth } = panelLimits(viewportWidth);

  const [preferredChatWidth, setChatWidth] = useState(440);
  const chatWidth = Math.max(minimumChatWidth, Math.min(maximumChatWidth, preferredChatWidth));
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const isDraggingRef = React.useRef(false);

  // Update mobile view state on window resize
  React.useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Listen to popstate event for browser back/forward URL navigation
  React.useEffect(() => {
    const handlePopState = () => {
      const currentId = getActiveProjectId();
      setActiveId(currentId);
      const params = new URLSearchParams(window.location.search);
      if (params.get('project')) {
        setCurrentView('workspace');
      } else if (window.location.pathname === '/dashboard') {
        setCurrentView('dashboard');
      } else {
        setCurrentView('landing');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleSelectProject = (id: string) => {
    if (!id) return;
    activeIdRef.current = id;
    setActiveProjectId(id);
    setActiveId(id);
    if (typeof window !== 'undefined' && window.history?.pushState) {
      const url = new URL(window.location.href);
      url.pathname = '/';
      url.searchParams.set('project', id);
      window.history.pushState({}, '', url.toString());
    }
  };

  const handleGoHome = () => {
    setCurrentView('landing');
    if (typeof window !== 'undefined' && window.history?.pushState) {
      const url = new URL(window.location.href);
      url.searchParams.delete('project');
      url.pathname = '/';
      window.history.pushState({}, '', url.toString());
    }
  };

  const requestGoHome = () => {
    if ((generationActive || runtimeActive) && currentView === 'workspace') {
      setPendingWorkspaceExit('home');
      return;
    }
    handleGoHome();
  };

  const handleOpenDashboard = () => {
    if (!user) {
      setAuthModal({ isOpen: true, mode: 'login' });
      return;
    }
    setCurrentView('dashboard');
    const url = new URL(window.location.href);
    url.pathname = '/dashboard';
    url.searchParams.delete('project');
    window.history.pushState({}, '', url.toString());
  };

  const requestOpenDashboard = () => {
    if ((generationActive || runtimeActive) && currentView === 'workspace') {
      setPendingWorkspaceExit('dashboard');
      return;
    }
    handleOpenDashboard();
  };

  const [authModal, setAuthModal] = useState<{ isOpen: boolean; mode: 'login' | 'signup' }>({
    isOpen: false,
    mode: 'signup',
  });

  const handleAuthenticated = (newUser: SessionUser) => {
    setUser(newUser);
    setActiveId(getActiveProjectId());
    setAuthModal({ isOpen: false, mode: 'login' });
    setAuthError(null);
    saveGooglePrompt(null);
    if (pendingPromptRef.current) {
      const { prompt } = pendingPromptRef.current;
      pendingPromptRef.current = null;
      if (createProjectLockedRef.current) return;
      // Use newUser directly — React state hasn't re-rendered yet
      const title = shortTitleFromPrompt(prompt);
      const submissionKey = crypto.randomUUID();
      const newProj = createProject(title);
      markProjectCreationPending(newProj.id, submissionKey);
      setOnboardingState(newProj.id, { createdFirstProject: true });
      setPendingInitialPrompt({ projectId: newProj.id, prompt });
      prefetchWsTicket();
      handleSelectProject(newProj.id);
      setCurrentView('workspace');
    } else if (!new URLSearchParams(window.location.search).has('project')) {
      // Plain sign-in (no pending prompt): leaving the user on the marketing
      // homepage makes it look like login did nothing — take them to their
      // projects instead. A ?project= deep link keeps its workspace target.
      // Don't call handleOpenDashboard: it reads the stale `user` state.
      setCurrentView('dashboard');
      const url = new URL(window.location.href);
      url.pathname = '/dashboard';
      url.searchParams.delete('project');
      window.history.pushState({}, '', url.toString());
    }
  };

  const handleOpenLogin = (mode: 'login' | 'signup' = 'signup') => {
    setAuthModal({ isOpen: true, mode });
  };

  const handleOpenProject = (id: string) => {
    if (!user) {
      setAuthModal({ isOpen: true, mode: 'login' });
      return;
    }
    prefetchWsTicket();
    handleSelectProject(id);
    setCurrentView('workspace');
  };


  const handleSubmitInitialPrompt = (prompt: string) => {
    if (!user) {
      pendingPromptRef.current = { prompt };
      setAuthModal({ isOpen: true, mode: 'signup' });
      return;
    }
    if (createProjectLockedRef.current) return;
    const title = shortTitleFromPrompt(prompt);
    const submissionKey = crypto.randomUUID();
    const newProj = createProject(title);
    markProjectCreationPending(newProj.id, submissionKey);
    setOnboardingState(newProj.id, { createdFirstProject: true });
    setPendingInitialPrompt({ projectId: newProj.id, prompt });
    prefetchWsTicket();
    handleSelectProject(newProj.id);
    setCurrentView('workspace');
  };

  const dragStartRef = useRef({ x: 0, width: 0 });
  const finishResize = () => {
    isDraggingRef.current = false;
    setIsResizing(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.body.classList.remove('is-resizing');
  };
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStartRef.current = { x: event.clientX, width: chatWidth };
    isDraggingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.classList.add('is-resizing');
  };

  const handleDoubleClickDivider = () => {
    setChatWidth(440);
  };

  // The server revokes the token; we drop the local copy regardless so the UI
  // never lingers on a session the server has already invalidated.
  const handleLogout = async () => {
    await logout();
  };

  if (!authChecked) {
    return (
      <div
        className="studio-session-loading"
        aria-busy="true"
        aria-label="Verifying session"
      >
        <div><BrainHalfLogo size={28} strokeWidth={1.5} color="currentColor" /><span>Opening your studio…</span></div>
      </div>
    );
  }

  // When visiting workspace directly (e.g. ?project=xyz) without an authenticated session,
  // require login gate
  if (!user && currentView !== 'landing') {
    return (
      <LoginScreen
        onAuthenticated={handleAuthenticated}
        initialError={authError}
        onGoogleStart={() => saveGooglePrompt(pendingPromptRef.current)}
        onClose={handleGoHome}
      />
    );
  }

  if (currentView === 'landing' || !user) {
    return (
      <>
        <LandingPage
          key={user?.id || 'signed-out'}
          onOpenProject={handleOpenProject}
          onSubmitInitialPrompt={handleSubmitInitialPrompt}
          creatingProject={creatingProject}
          currentUser={user}
          onLogout={handleLogout}
          onLoginRequest={handleOpenLogin}
          onOpenDashboard={handleOpenDashboard}
        />
        {authModal.isOpen && (
          <LoginScreen
            onAuthenticated={handleAuthenticated}
            initialError={authError}
            onGoogleStart={() => saveGooglePrompt(pendingPromptRef.current)}
            onClose={() => setAuthModal({ isOpen: false, mode: 'login' })}
            initialMode={authModal.mode}
          />
        )}
      </>
    );
  }

  const handleCreateNewProject = async () => {
    if (createProjectLockedRef.current) return;
    setPendingInitialPrompt(null);
    pendingPromptRef.current = null;
    setMobileTab('chat');
    // Drop abandoned blank drafts first so they never pile up against the
    // 50-project limit. Best-effort: creation proceeds even if cleanup fails.
    await purgeEmptyDrafts().catch(() => {});
    const submissionKey = crypto.randomUUID();
    const newProj = createProject('Untitled Project');
    markProjectCreationPending(newProj.id, submissionKey);
    setOnboardingState(newProj.id, { createdFirstProject: true });
    handleSelectProject(newProj.id);
    setCurrentView('workspace');
  };

  const requestCreateNewProject = () => {
    if (generationActive || runtimeActive) {
      setPendingWorkspaceExit('new');
      return;
    }
    handleCreateNewProject();
  };

  const confirmWorkspaceExit = async () => {
    const next = pendingWorkspaceExit;
    setClosingProject(true); setCloseError('');
    appEvents.emit('stop-generation-request', { projectId: activeProjectId });
    try {
      let stopped = false;
      for (let attempt = 0; attempt < WORKSPACE_EXIT_ATTEMPTS && !stopped; attempt++) {
        const response = await authFetch(runtimeBase(activeProjectId).replace(/\/runtime$/, '/stop'), { method: 'POST', signal: AbortSignal.timeout(WORKSPACE_EXIT_TIMEOUT) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not confirm shutdown. Try again.');
        stopped = result.ok === true;
      }
      if (!stopped) throw new Error('The server is still stopping. Keep this page open and try again.');
      setGenerationActive(false); setRuntimeActive(false); setPendingWorkspaceExit(null);
      if (next === 'new') handleCreateNewProject(); else if (next === 'dashboard') handleOpenDashboard(); else handleGoHome();
    } catch (error) { setCloseError(error instanceof Error ? error.message : 'Shutdown could not be confirmed.'); }
    finally { setClosingProject(false); }
  };

  if (currentView === 'dashboard') {
    return (
      <ErrorBoundary>
      <Suspense fallback={<div className="studio-session-loading" aria-busy="true" aria-label="Loading dashboard"><div><BrainHalfLogo size={28} strokeWidth={1.5} color="currentColor" /></div></div>}>
        <DashboardPage currentUser={user} onOpenProject={handleOpenProject} onCreateProject={handleCreateNewProject} creatingProject={creatingProject} onGoHome={handleGoHome} onLogout={handleLogout} />
      </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
    <Suspense fallback={<div className="studio-session-loading" aria-busy="true" aria-label="Loading workspace"><div><BrainHalfLogo size={28} strokeWidth={1.5} color="currentColor" /></div></div>}>
    <div className="app-container studio-workspace">
      <div className="main-content">
        {/* TopNav is now rendered inside Workspace for workspace mode (Bolt-style unified topbar) */}
        {/* Mobile view switcher. Lives outside workspace-area because the
            Workspace (and the TopNav inside it) is display:none while the chat
            tab is active — a tab bar rendered there could never switch away
            from chat. */}
        {isMobile && (
          <div className="segmented-control studio-mobile-tabs" role="tablist" aria-label="Workspace view">
            {([['chat', 'Chat', Bot], ['preview', 'Preview', Monitor], ['code', 'Code', Code2]] as const).map(([tab, label, Icon]) => (
              <button key={tab} role="tab" type="button" className={`segmented-tab${mobileTab === tab ? ' active' : ''}`}
                aria-selected={mobileTab === tab}
                onClick={() => setMobileTab(tab)}>
                <Icon size={16} strokeWidth={1.75} aria-hidden="true" /><span>{label}</span>
              </button>
            ))}
          </div>
        )}
        <div className={`workspace-area ${isMobile ? 'is-mobile' : ''}`}>
          <div style={{ display: !isMobile || mobileTab === 'chat' ? 'contents' : 'none' }}>
            <SectionErrorBoundary name="Chat">
            <ChatPanel
              key={`chat-${user.id}-${activeProjectId}`}
              activeProjectId={activeProjectId}
              width={isMobile ? undefined : chatWidth}
              initialPrompt={pendingInitialPrompt?.projectId === activeProjectId ? pendingInitialPrompt.prompt : null}
              onInitialPromptConsumed={() => setPendingInitialPrompt(null)}
            />
            </SectionErrorBoundary>
          </div>
          {!isMobile && (
            <div 
              className={`panel-resize-handle ${isResizing ? 'active' : ''}`}
              onPointerDown={handlePointerDown}
              onPointerMove={event => {
                if (!isDraggingRef.current) return;
                const { minimum, maximum } = panelLimits(window.innerWidth);
                setChatWidth(Math.max(minimum, Math.min(maximum, dragStartRef.current.width + event.clientX - dragStartRef.current.x)));
              }}
              onPointerUp={finishResize}
              onPointerCancel={finishResize}
              onLostPointerCapture={finishResize}
              onDoubleClick={handleDoubleClickDivider}
              role="separator"
              tabIndex={0}
              aria-label="Resize chat panel"
              aria-orientation="vertical"
              aria-valuemin={minimumChatWidth}
              aria-valuemax={maximumChatWidth}
              aria-valuenow={chatWidth}
              aria-valuetext={`${chatWidth} pixels`}
              onKeyDown={event => {
                const { minimum, maximum } = panelLimits(viewportWidth);
                const step = event.shiftKey ? 50 : 10;
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) {
                  event.preventDefault();
                  setChatWidth(event.key === 'Enter' ? 440 : Math.max(minimum, Math.min(maximum,
                    event.key === 'Home' ? minimum : event.key === 'End' ? maximum :
                    chatWidth + (event.key === 'ArrowRight' ? step : -step)
                  )));
                }
              }}
              title="Drag to resize · Arrow keys to adjust · Enter to reset"
            ><GripVertical size={16} aria-hidden="true" /></div>
          )}
          <div style={{ display: !isMobile || mobileTab !== 'chat' ? 'contents' : 'none' }}>
            <SectionErrorBoundary name="Workspace">
            <Workspace
              key={`workspace-${user.id}-${activeProjectId}`}
              activeProjectId={activeProjectId}
              mobileTab={isMobile ? mobileTab : undefined}
              onSelectMobileTab={isMobile ? setMobileTab : undefined}
              currentUser={user}
              onGoHome={requestGoHome}
              onNewProject={requestCreateNewProject}
              onOpenDashboard={requestOpenDashboard}
              onLogout={handleLogout}
              creatingProject={creatingProject}
              isMobile={isMobile}
            />
            </SectionErrorBoundary>
          </div>
        </div>
      </div>
      <ConfirmModal
        isOpen={pendingWorkspaceExit !== null}
        title="Stop generation and close project?"
        message="Closing stops generation and running project jobs. Completed files are kept. BrainHalf will wait for the server to confirm shutdown."
        confirmLabel={pendingWorkspaceExit === 'new' ? 'Stop and create new' : 'Stop and close'}
        cancelLabel="Keep building"
        isDestructive={false}
        pending={closingProject}
        error={closeError}
        onConfirm={confirmWorkspaceExit}
        onCancel={() => setPendingWorkspaceExit(null)}
      />
    </div>
    </Suspense>
    </ErrorBoundary>
  );
}

export default App;
