import React, { useState, useEffect, useRef } from 'react';
import { Play, Download, Share2, Check, X, ExternalLink, Cloud, Settings, RotateCcw, Bot, Code2, Plus, LogOut, LayoutGrid } from 'lucide-react';
import { appEvents } from '../lib/events';
import { getProjects, updateProjectName } from '../lib/project-store';
import { usePlatformStatus } from '../lib/status-store';
import ConfirmModal from './ConfirmModal';

interface TopNavProps {
  activeProjectId: string;
  onProjectRenamed?: (id: string, name: string) => void;
  onSelectProject?: (id: string) => void;
  mobileTab?: 'chat' | 'code' | 'preview';
  onSelectMobileTab?: (tab: 'chat' | 'code' | 'preview') => void;
  isMobile?: boolean;
  currentUser?: { email?: string; name?: string; devMode?: boolean } | null;
  onLogout?: () => void | Promise<void>;
  onGoHome?: () => void;
  onNewProject?: () => void;
}

const TopNav: React.FC<TopNavProps> = ({
  activeProjectId,
  onProjectRenamed,
  onSelectProject: _onSelectProject,
  mobileTab = 'chat',
  onSelectMobileTab,
  isMobile = false,
  currentUser,
  onLogout,
  onGoHome,
  onNewProject,
}) => {
  const [overrideName, setOverrideName] = useState<string | null>(null);
  const [prevId, setPrevId] = useState(activeProjectId);
  if (prevId !== activeProjectId) {
    setPrevId(activeProjectId);
    setOverrideName(null);
  }

  const currentProjectName = getProjects().find(p => p.id === activeProjectId)?.name || 'Untitled Project';

  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [copied, setCopied] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const projectName = overrideName ?? currentProjectName;

  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The workspace's "Publish" button emits this; the modal lives here because
    // TopNav is the one component rendered above both the chat and workspace
    // panes. Without this listener the button silently did nothing.
    const unsubDeploy = appEvents.on('open-deploy-modal', () => {
      setShowDeployModal(true);
    });
    const unsub = appEvents.on('project-renamed', (payload: { id: string; name: string }) => {
      if (payload.id === activeProjectId) {
        setOverrideName(payload.name);
      }
    });
    return () => {
      unsubDeploy();
      unsub();
    };
  }, [activeProjectId]);

  // Click outside to close menus
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowMoreMenu(false);
        setShowDeployModal(false);
        setShowSettingsModal(false);
        setIsEditing(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSaveName = () => {
    const trimmed = editedName.trim() || 'Untitled Project';
    setOverrideName(trimmed);
    setIsEditing(false);
    updateProjectName(activeProjectId, trimmed);
    if (onProjectRenamed) onProjectRenamed(activeProjectId, trimmed);
    appEvents.emit('project-renamed', { id: activeProjectId, name: trimmed });
  };

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?project=${activeProjectId}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      prompt('Copy project URL:', shareUrl);
    }
  };

  const handleExport = () => {
    appEvents.emit('request-export', { projectName });
  };

  const handleGitHubExport = () => {
    appEvents.emit('open-github-modal');
  };

  const handleResetWorkspace = () => {
    setShowResetConfirm(true);
    setShowMoreMenu(false);
  };

  const confirmResetWorkspace = () => {
    appEvents.emit('clear-workspace');
    setShowResetConfirm(false);
  };

  const userInitial = (currentUser?.name || currentUser?.email || 'K').trim()[0].toUpperCase();
  const platformStatus = usePlatformStatus(activeProjectId);

  return (
    <div className="top-nav" role="banner">
      <div className="top-nav-left-cluster" style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexShrink: 1 }}>
        {onGoHome && (
          <button
            onClick={onGoHome}
            className="landing-home-pill"
            style={{ padding: '4px 10px', fontSize: '12px', height: '28px', gap: '6px' }}
            title="Return to Home"
            aria-label="Return to Home"
          >
            <LayoutGrid size={13} strokeWidth={2} />
            <span>Home</span>
          </button>
        )}

        {/* Tab pill: [ • chat-easy-3  × ] */}
        <div
          className="top-nav-project-tab"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(255, 255, 255, 0.07)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '7px',
            padding: '3px 10px',
            height: '28px',
            minWidth: 0,
            cursor: 'pointer'
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#22c55e',
              boxShadow: '0 0 6px rgba(34, 197, 94, 0.8)',
              flexShrink: 0
            }}
          />
          {isEditing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input 
                type="text"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') setIsEditing(false);
                }}
                autoFocus
                aria-label="Rename project input"
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#ffffff',
                  fontSize: '12.5px',
                  fontWeight: 500,
                  padding: '2px 4px',
                  outline: 'none',
                  fontFamily: 'var(--font-brand)',
                  width: '110px'
                }}
              />
              <button 
                onClick={handleSaveName}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                title="Save name"
              >
                <Check size={14} strokeWidth={2} color="var(--color-success)" />
              </button>
            </div>
          ) : (
            <span
              onClick={() => { setIsEditing(true); setEditedName(projectName); }}
              title="Click to rename project"
              style={{
                fontSize: '12.5px',
                fontWeight: 500,
                color: '#ffffff',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '180px'
              }}
            >
              {projectName}
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onGoHome?.();
            }}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'rgba(255, 255, 255, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: '2px'
            }}
            title="Close tab"
            aria-label="Close tab"
          >
            <X size={12} strokeWidth={2} />
          </button>
        </div>

        {/* Plus Button next to project tab */}
        <button
          onClick={() => onNewProject ? onNewProject() : onGoHome?.()}
          style={{
            width: '26px',
            height: '26px',
            borderRadius: '6px',
            background: 'transparent',
            border: 'none',
            color: 'rgba(255, 255, 255, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            transition: 'background 0.15s ease, color 0.15s ease'
          }}
          className="icon-btn"
          title="New project"
          aria-label="New project"
        >
          <Plus size={15} strokeWidth={2} />
        </button>
      </div>
      
      {isMobile && onSelectMobileTab && (
        <div className="segmented-control" style={{ padding: '2px', flexShrink: 0 }}>
          <button
            className={`segmented-tab ${mobileTab === 'chat' ? 'active' : ''}`}
            onClick={() => onSelectMobileTab('chat')}
            style={{ padding: '4px 10px', fontSize: '11.5px' }}
          >
            <Bot size={16} strokeWidth={1.75} />
            <span>Chat</span>
          </button>
          <button
            className={`segmented-tab ${mobileTab === 'code' ? 'active' : ''}`}
            onClick={() => onSelectMobileTab('code')}
            style={{ padding: '4px 10px', fontSize: '11.5px' }}
          >
            <Code2 size={16} strokeWidth={1.75} />
            <span>Code</span>
          </button>
          <button
            className={`segmented-tab ${mobileTab === 'preview' ? 'active' : ''}`}
            onClick={() => onSelectMobileTab('preview')}
            style={{ padding: '4px 10px', fontSize: '11.5px' }}
          >
            <Play size={16} strokeWidth={1.75} />
            <span>Preview</span>
          </button>
        </div>
      )}

      {/* Right Cluster: Status pill + User avatar */}
      <div className="top-nav-right-cluster" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0, marginLeft: 'auto' }}>

        {!isMobile && (
          <div
            data-testid="topbar-status-pill"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '3px 9px',
              borderRadius: '6px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              fontSize: '11.5px',
              color: 'rgba(255,255,255,0.7)',
              flexShrink: 0,
              userSelect: 'none',
            }}
          >
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: platformStatus.dotColor,
              boxShadow: platformStatus.glow,
              flexShrink: 0,
            }} />
            <span>{platformStatus.topBarLabel}</span>
          </div>
        )}

        <div style={{ position: 'relative' }} ref={moreMenuRef}>
          <button 
            onClick={() => setShowMoreMenu(prev => !prev)}
            title={currentUser?.email || 'User Profile'}
            aria-label="User profile and menu"
            style={{ 
              width: '28px', 
              height: '28px', 
              borderRadius: '50%',
              background: '#2563eb',
              color: '#ffffff',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            {userInitial}
          </button>

          {showMoreMenu && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              width: '210px',
              background: 'rgba(22, 24, 30, 0.95)',
              backdropFilter: 'blur(24px) saturate(180%)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '8px',
              boxShadow: '0 16px 36px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.05)',
              padding: '5px',
              zIndex: 1000
            }}>
              <button 
                className="deploy-menu-item"
                onClick={() => {
                  handleShare();
                  setShowMoreMenu(false);
                }}
              >
                {copied ? <Check size={16} strokeWidth={1.75} color="var(--color-success)" /> : <Share2 size={16} strokeWidth={1.75} color="var(--color-neutral)" />}
                <span>{copied ? 'Link Copied!' : 'Share Project Link'}</span>
              </button>
              <button 
                className="deploy-menu-item"
                onClick={() => {
                  handleExport();
                  setShowMoreMenu(false);
                }}
              >
                <Download size={16} strokeWidth={1.75} color="var(--color-neutral)" />
                <span>Export ZIP Bundle</span>
              </button>
              <button 
                className="deploy-menu-item"
                onClick={() => {
                  handleGitHubExport();
                  setShowMoreMenu(false);
                }}
              >
                <Cloud size={16} strokeWidth={1.75} color="var(--color-neutral)" />
                <span>Export to GitHub</span>
              </button>
              <div className="deploy-menu-divider" />
              <button 
                className="deploy-menu-item"
                onClick={() => {
                  setShowSettingsModal(true);
                  setShowMoreMenu(false);
                }}
              >
                <Settings size={16} strokeWidth={1.75} color="var(--color-neutral)" />
                <span>Project Settings</span>
              </button>
              <button 
                className="deploy-menu-item"
                onClick={handleResetWorkspace}
                style={{ color: 'var(--color-error)' }}
              >
                <RotateCcw size={16} strokeWidth={1.75} color="var(--color-error)" />
                <span>Reset to Default Template</span>
              </button>
            </div>
          )}
        </div>

        {/* Authenticated identity + sign out. On mobile the row has no room for
            the email, so it collapses to a single sign-out icon; the address
            stays reachable via the button's tooltip. */}
        {currentUser && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {!isMobile && currentUser.devMode && (
              <span
                title="Anonymous development mode is active on this deployment. Project isolation is disabled."
                style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: '#eab308',
                  background: 'rgba(234,179,8,0.1)',
                  border: '1px solid rgba(234,179,8,0.3)',
                  borderRadius: '9999px',
                  padding: '3px 8px',
                }}
              >
                Dev
              </span>
            )}
            {!isMobile && (
              <span
                title={currentUser.email || 'Signed in'}
                style={{ fontSize: '12px', color: 'var(--text-secondary)', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {currentUser.email || currentUser.name || 'Signed in'}
              </span>
            )}
            {onLogout && (
              <button
                className="icon-btn"
                onClick={() => { void onLogout(); }}
                title={isMobile ? `Sign out (${currentUser.email || currentUser.name || 'signed in'})` : 'Sign out'}
                aria-label="Sign out"
                style={{ width: '32px', height: '32px' }}
              >
                <LogOut size={15} strokeWidth={1.75} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Cloudflare Deploy Modal */}
      {showDeployModal && (
        <div 
          onClick={() => setShowDeployModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="deploy-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-chat-panel)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '32px',
              maxWidth: '520px',
              width: '90%',
              boxShadow: '0 20px 50px rgba(0,0,0,0.6)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Cloud size={16} strokeWidth={1.75} color="var(--accent-light)" />
                <h3 id="deploy-modal-title" style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)', fontFamily: 'var(--font-brand)' }}>
                  Deploy {projectName}
                </h3>
              </div>
              <button 
                className="icon-btn" 
                onClick={() => setShowDeployModal(false)}
                aria-label="Close modal"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <span style={{ 
                background: 'rgba(16, 185, 129, 0.15)', 
                color: '#10b981', 
                border: '1px solid rgba(16, 185, 129, 0.3)', 
                padding: '3px 10px', 
                borderRadius: '9999px', 
                fontSize: '11px', 
                fontWeight: 600,
                letterSpacing: '0.03em'
              }}>
                Workers for Platforms Active
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Namespace: brainhalf-projects</span>
            </div>

            <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '16px' }}>
              Both frontend UI and live backend REST API routes with SQLite storage are deployed together on Cloudflare's ultra-low-latency edge network:
            </p>

            <div style={{ background: '#090b10', border: '1px solid #1f2430', borderRadius: '6px', padding: '16px', marginBottom: '20px' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', fontWeight: 600 }}>
                Live Edge Dispatch URL
              </div>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between', 
                background: '#12151d', 
                padding: '8px 12px', 
                borderRadius: '4px',
                border: '1px solid #282f3d',
                fontFamily: 'var(--font-mono)', 
                fontSize: '12.5px', 
                color: '#60a5fa' 
              }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {typeof window !== 'undefined' ? window.location.origin : 'https://brainhalf.com'}/p/{activeProjectId}
                </span>
                <button
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '11px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 6px',
                    borderRadius: '4px'
                  }}
                  onClick={() => {
                    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://brainhalf.com';
                    navigator.clipboard.writeText(`${baseUrl}/p/${activeProjectId}`);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? <Check size={16} strokeWidth={1.75} color="#10b981" /> : null}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                # Custom CLI deployment to dispatch namespace:
                <div style={{ color: '#a78bfa', marginTop: '4px' }}>
                  npx wrangler deploy --dispatch-namespace brainhalf-projects --name {activeProjectId}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button 
                className="button-ghost"
                onClick={() => {
                  handleExport();
                  setShowDeployModal(false);
                }}
              >
                <Download size={16} strokeWidth={1.75} /> Export ZIP
              </button>
              <button 
                className="button-ghost"
                onClick={() => {
                  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://brainhalf.com';
                  window.open(`${baseUrl}/preview/${activeProjectId}/index.html`, '_blank');
                  setShowDeployModal(false);
                }}
              >
                Preview Runtime <ExternalLink size={16} strokeWidth={1.75} />
              </button>
              <button 
                className="button-primary"
                onClick={() => {
                  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://brainhalf.com';
                  window.open(`${baseUrl}/p/${activeProjectId}`, '_blank');
                  setShowDeployModal(false);
                }}
              >
                Open Live Edge App ↗
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deployment Settings Modal */}
      {showSettingsModal && (
        <div 
          onClick={() => setShowSettingsModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-chat-panel)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '32px',
              maxWidth: '500px',
              width: '90%',
              boxShadow: '0 20px 50px rgba(0,0,0,0.6)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Settings size={16} strokeWidth={1.75} color="var(--accent-light)" />
                <h3 id="settings-modal-title" style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)', fontFamily: 'var(--font-brand)' }}>
                  Deployment Settings
                </h3>
              </div>
              <button 
                className="icon-btn" 
                onClick={() => setShowSettingsModal(false)}
                aria-label="Close modal"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              <div>
                <label style={{ display: 'block', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '6px' }}>Build Framework</label>
                <div style={{ padding: '10px 14px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '6px', color: '#e2e8f0', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                  Vite + React 18 (Client SPA)
                </div>
              </div>

              <div>
                <label style={{ display: 'block', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '6px' }}>Build Output Directory</label>
                <div style={{ padding: '10px 14px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '6px', color: '#e2e8f0', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                  dist/
                </div>
              </div>

              <div>
                <label style={{ display: 'block', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '6px' }}>Deploy Targets</label>
                <p style={{ margin: 0, lineHeight: 1.5 }}>
                  Compatible with Cloudflare Pages, Vercel, Netlify, and GitHub Pages. Export as ZIP to run locally with <code style={{ color: 'var(--color-success)' }}>npm run build</code>.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
              <button 
                className="button-primary"
                onClick={() => setShowSettingsModal(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Accessible Non-Blocking Workspace Reset Confirmation Dialog */}
      <ConfirmModal
        isOpen={showResetConfirm}
        title="Reset Workspace"
        message="Are you sure you want to reset the workspace to the default React template? Any unsaved edits will be permanently cleared."
        confirmLabel="Reset Workspace"
        onConfirm={confirmResetWorkspace}
        onCancel={() => setShowResetConfirm(false)}
      />
    </div>
  );
};

export default TopNav;
