import React, { useState, useEffect, useRef } from 'react';
import { Play, Download, Share2, Check, Edit2, X, ExternalLink, MoreHorizontal, Cloud, Settings, RotateCcw, Menu, Bot, Code2, Plus } from 'lucide-react';
import { appEvents } from '../lib/events';
import { getProjects, updateProjectName, createProject } from '../lib/project-store';
import ConfirmModal from './ConfirmModal';

interface TopNavProps {
  activeProjectId: string;
  onProjectRenamed?: (id: string, name: string) => void;
  onSelectProject?: (id: string) => void;
  onToggleMobileSidebar?: () => void;
  mobileTab?: 'chat' | 'code' | 'preview';
  onSelectMobileTab?: (tab: 'chat' | 'code' | 'preview') => void;
  isMobile?: boolean;
}

const TopNav: React.FC<TopNavProps> = ({ 
  activeProjectId, 
  onProjectRenamed, 
  onSelectProject,
  onToggleMobileSidebar, 
  mobileTab = 'chat', 
  onSelectMobileTab, 
  isMobile = false 
}) => {
  const [overrideName, setOverrideName] = useState<string | null>(null);
  const [prevId, setPrevId] = useState(activeProjectId);
  if (prevId !== activeProjectId) {
    setPrevId(activeProjectId);
    setOverrideName(null);
  }

  const currentProjectName = React.useMemo(() => {
    const projects = getProjects();
    const curr = projects.find(p => p.id === activeProjectId);
    return curr?.name || 'Untitled Project';
  }, [activeProjectId]);

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
    const unsub = appEvents.on('project-renamed', (payload: { id: string; name: string }) => {
      if (payload.id === activeProjectId) {
        setOverrideName(payload.name);
      }
    });
    return () => unsub();
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

  const handleResetWorkspace = () => {
    setShowResetConfirm(true);
    setShowMoreMenu(false);
  };

  const confirmResetWorkspace = () => {
    appEvents.emit('clear-workspace');
    setShowResetConfirm(false);
  };

  const handleQuickCreate = () => {
    const projects = getProjects();
    const existingNames = new Set(projects.map(p => p.name));
    let counter = projects.length + 1;
    while (existingNames.has(`Project ${counter}`)) {
      counter++;
    }
    const newProj = createProject(`Project ${counter}`);
    appEvents.emit('project-renamed', { id: newProj.id, name: newProj.name });
    if (onSelectProject) {
      onSelectProject(newProj.id);
    }
  };

  return (
    <div className="top-nav" role="banner">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {isMobile && onToggleMobileSidebar && (
          <button 
            className="icon-btn" 
            onClick={onToggleMobileSidebar}
            title="Open Projects"
            aria-label="Open Projects"
            style={{ padding: '6px', color: 'var(--text-primary)' }}
          >
            <Menu size={18} />
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            background: '#18181b',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }} title="BrainHalf Platform">
            <img 
              src="/brainhalflogo.png" 
              alt="BrainHalf" 
              style={{ width: '16px', height: '16px', objectFit: 'contain' }} 
            />
          </div>
          <span 
            style={{ 
              width: '7px', 
              height: '7px', 
              borderRadius: '50%', 
              background: 'var(--color-success)', 
              boxShadow: '0 0 6px var(--color-success)' 
            }}
            title="Session active"
            aria-label="Session active"
          />

          {isEditing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  padding: '3px 8px',
                  outline: 'none',
                  fontFamily: 'var(--font-brand)',
                }}
              />
              <button 
                onClick={handleSaveName}
                className="icon-btn" 
                style={{ padding: '3px' }}
                title="Save name"
                aria-label="Save name"
              >
                <Check size={13} color="var(--color-success)" />
              </button>
              <button 
                onClick={() => setIsEditing(false)}
                className="icon-btn" 
                style={{ padding: '3px' }}
                title="Cancel"
                aria-label="Cancel editing name"
              >
                <X size={13} color="var(--color-error)" />
              </button>
            </div>
          ) : (
            <div 
              onClick={() => { setIsEditing(true); setEditedName(projectName); }}
              title="Click to rename project"
              tabIndex={0}
              role="button"
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setIsEditing(true);
                  setEditedName(projectName);
                }
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', outline: 'none' }}
            >
              <h2 style={{ 
                fontSize: '13.5px', 
                fontWeight: 600, 
                margin: 0, 
                fontFamily: 'var(--font-brand)',
                color: 'var(--text-primary)',
                letterSpacing: '-0.2px'
              }}>
                {projectName}
              </h2>
              <Edit2 size={11} style={{ opacity: 0.35 }} />
            </div>
          )}

          <button
            onClick={handleQuickCreate}
            className="icon-btn"
            title="Create New Project"
            aria-label="Create New Project"
            style={{
              padding: '3px 6px',
              color: 'var(--text-muted)',
              borderRadius: '4px',
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              fontWeight: 500,
              marginLeft: '4px',
              flexShrink: 0
            }}
          >
            <Plus size={12} />
            {!isMobile && <span>New</span>}
          </button>
        </div>
      </div>
      
      {isMobile && onSelectMobileTab && (
        <div className="segmented-control" style={{ padding: '2px', flexShrink: 0 }}>
          <button
            className={`segmented-tab ${mobileTab === 'chat' ? 'active' : ''}`}
            onClick={() => onSelectMobileTab('chat')}
            style={{ padding: '4px 10px', fontSize: '11.5px' }}
          >
            <Bot size={12} />
            <span>Chat</span>
          </button>
          <button
            className={`segmented-tab ${mobileTab === 'code' ? 'active' : ''}`}
            onClick={() => onSelectMobileTab('code')}
            style={{ padding: '4px 10px', fontSize: '11.5px' }}
          >
            <Code2 size={12} />
            <span>Code</span>
          </button>
          <button
            className={`segmented-tab ${mobileTab === 'preview' ? 'active' : ''}`}
            onClick={() => onSelectMobileTab('preview')}
            style={{ padding: '4px 10px', fontSize: '11.5px' }}
          >
            <Play size={12} />
            <span>Preview</span>
          </button>
        </div>
      )}

      {/* Clear Action Hierarchy: Share  ⋯  [Export]  [Deploy ↗ ▾] */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button 
          className="button-ghost" 
          onClick={handleShare} 
          title="Share project link"
          aria-label="Share project link"
          style={{ padding: '6px 12px', fontSize: '12px' }}
        >
          {copied ? <Check size={13} color="var(--color-success)" /> : <Share2 size={13} />}
          <span>{copied ? 'Copied' : 'Share'}</span>
        </button>

        {/* More Options Dropdown (...) */}
        <div style={{ position: 'relative' }} ref={moreMenuRef}>
          <button 
            className="icon-btn" 
            onClick={() => setShowMoreMenu(prev => !prev)}
            title="More project actions"
            aria-label="More project actions"
            aria-expanded={showMoreMenu}
            style={{ width: '30px', height: '30px' }}
          >
            <MoreHorizontal size={15} />
          </button>

          {showMoreMenu && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              width: '210px',
              background: '#111420',
              border: '1px solid var(--border-medium)',
              borderRadius: '8px',
              boxShadow: '0 12px 32px rgba(0, 0, 0, 0.6)',
              padding: '5px',
              zIndex: 1000
            }}>
              <button 
                className="deploy-menu-item"
                onClick={() => {
                  setShowSettingsModal(true);
                  setShowMoreMenu(false);
                }}
              >
                <Settings size={13} color="var(--color-neutral)" />
                <span>Project Settings</span>
              </button>
              <button 
                className="deploy-menu-item"
                onClick={() => {
                  handleExport();
                  setShowMoreMenu(false);
                }}
              >
                <Download size={13} color="var(--color-neutral)" />
                <span>Export ZIP Bundle</span>
              </button>
              <div className="deploy-menu-divider" />
              <button 
                className="deploy-menu-item"
                onClick={handleResetWorkspace}
                style={{ color: 'var(--color-error)' }}
              >
                <RotateCcw size={13} color="var(--color-error)" />
                <span>Reset to Default Template</span>
              </button>
            </div>
          )}
        </div>

        {/* Secondary Action: Export */}
        <button 
          className="button-ghost" 
          onClick={handleExport} 
          title="Download complete project as a ZIP"
          aria-label="Download complete project as a ZIP"
          style={{ padding: '6px 12px', fontSize: '12px' }}
        >
          <Download size={13} /> 
          <span>Export</span>
        </button>

        {/* Primary CTA: Deploy ↗ */}
        <button 
          className="deploy-main-action"
          onClick={() => setShowDeployModal(true)}
          title="Deploy project to Cloudflare"
          aria-label="Deploy project to Cloudflare"
          style={{ borderRadius: '6px' }}
        >
          <Play size={12} fill="white" /> 
          <span>Deploy ↗</span>
        </button>
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
                <Cloud size={20} color="var(--accent-light)" />
                <h3 id="deploy-modal-title" style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)', fontFamily: 'var(--font-brand)' }}>
                  Deploy {projectName}
                </h3>
              </div>
              <button 
                className="icon-btn" 
                onClick={() => setShowDeployModal(false)}
                aria-label="Close modal"
              >
                <X size={18} />
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
              This project is hosted on Cloudflare's ultra-low-latency edge network with 0ms cold-start execution and automatic SSL:
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
                  https://brainhalf.com/p/{activeProjectId}
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
                    navigator.clipboard.writeText(`https://brainhalf.com/p/${activeProjectId}`);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? <Check size={12} color="#10b981" /> : null}
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
                <Download size={14} /> Export ZIP
              </button>
              <button 
                className="button-ghost"
                onClick={() => {
                  window.open(`https://brainhalf.com/preview/${activeProjectId}/index.html`, '_blank');
                  setShowDeployModal(false);
                }}
              >
                Preview Runtime <ExternalLink size={13} />
              </button>
              <button 
                className="button-primary"
                onClick={() => {
                  window.open(`https://brainhalf.com/p/${activeProjectId}`, '_blank');
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
                <Settings size={18} color="var(--accent-light)" />
                <h3 id="settings-modal-title" style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)', fontFamily: 'var(--font-brand)' }}>
                  Deployment Settings
                </h3>
              </div>
              <button 
                className="icon-btn" 
                onClick={() => setShowSettingsModal(false)}
                aria-label="Close modal"
              >
                <X size={18} />
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
