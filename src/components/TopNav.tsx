import React, { useState, useEffect, useRef, useId } from 'react';
import { Play, Check, Bot, Code2, Plus, LogOut, ChevronDown, Home, LayoutDashboard, LayoutGrid, Pencil, Moon, Sun, Monitor, Tablet, Smartphone, RotateCcw, ArrowUpRight, Share2, Cloud, Settings, Terminal, Server, Download, GitBranch, HelpCircle, MousePointer2 } from 'lucide-react';
import { appEvents } from '../lib/events';
import { getProjects, updateProjectName } from '../lib/project-store';
import { setTheme, useTheme } from '../lib/theme';
import ActionMenu from './ActionMenu';
import BrainHalfLogo from './BrainHalfLogo';
import ThemeToggle from './ThemeToggle';

type WorkspaceTab = 'code' | 'preview' | 'console' | 'logs';
type ViewportMode = 'desktop' | 'tablet' | 'mobile';

interface TopNavProps {
  activeProjectId: string;
  onProjectRenamed?: (id: string, name: string) => void;
  onSelectProject?: (id: string) => void;
  mobileTab?: 'chat' | 'code' | 'preview' | 'console' | 'logs';
  onSelectMobileTab?: (tab: 'chat' | 'code' | 'preview' | 'console' | 'logs') => void;
  isMobile?: boolean;
  currentUser?: { email?: string; name?: string; devMode?: boolean } | null;
  onLogout?: () => void | Promise<void>;
  onGoHome?: () => void;
  onOpenDashboard?: () => void;
  onNewProject?: () => void;
  creatingProject?: boolean;
  // Workspace tab/action props (Bolt-style integrated topbar)
  activeTab?: WorkspaceTab;
  onSelectTab?: (tab: WorkspaceTab) => void;
  hasGeneratedApp?: boolean;
  viewportMode?: ViewportMode;
  onViewportMode?: (mode: ViewportMode) => void;
  onRefreshPreview?: () => void;
  onOpenPreview?: () => void;
  previewReady?: boolean;
  openPreviewReady?: boolean;
  previewUrl?: string;
  shareCopied?: boolean;
  onShare?: () => void;
  publishOpen?: boolean;
  onPublish?: () => void;
  onExportZip?: () => void;
  onExportGithub?: () => void;
  onResetWorkspace?: () => void;
  hasFiles?: boolean;
  inspectActive?: boolean;
  onInspect?: () => void;
  publishPopoverSlot?: React.ReactNode;
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
  onOpenDashboard,
  onNewProject,
  creatingProject = false,
  activeTab,
  onSelectTab,
  hasGeneratedApp = false,
  viewportMode = 'desktop',
  onViewportMode,
  onRefreshPreview,
  onOpenPreview,
  previewReady = false,
  openPreviewReady = false,
  previewUrl,
  shareCopied = false,
  onShare,
  publishOpen = false,
  onPublish,
  onExportZip,
  onExportGithub,
  onResetWorkspace,
  hasFiles = false,
  inspectActive = false,
  onInspect,
  publishPopoverSlot,
}) => {
  const isWorkspaceMode = !!onSelectTab;
  const theme = useTheme();
  const [overrideName, setOverrideName] = useState<string | null>(null);
  const [prevId, setPrevId] = useState(activeProjectId);
  if (prevId !== activeProjectId) {
    setPrevId(activeProjectId);
    setOverrideName(null);
  }

  const currentProjectName = getProjects().find(p => p.id === activeProjectId)?.name || 'Untitled Project';

  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [showProjectTooltip, setShowProjectTooltip] = useState(false);
  const [projectTitleTruncated, setProjectTitleTruncated] = useState(false);
  const projectNameButtonRef = useRef<HTMLButtonElement>(null);
  const projectTooltipId = useId();
  const projectName = overrideName ?? currentProjectName;
  useEffect(() => {
    const unsub = appEvents.on('project-renamed', (payload: { id: string; name: string }) => {
      if (payload.id === activeProjectId) {
        setOverrideName(payload.name);
      }
    });
    return () => {
      unsub();
    };
  }, [activeProjectId]);

  useEffect(() => {
    setIsEditing(false);
  }, [activeProjectId]);

  useEffect(() => {
    const measure = () => {
      const node = projectNameButtonRef.current;
      if (!node) {
        setProjectTitleTruncated(false);
        return;
      }
      setProjectTitleTruncated(node.scrollWidth > node.clientWidth + 1);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [projectName, isEditing, isMobile]);

  const handleSaveName = () => {
    const trimmed = editedName.trim() || 'Untitled Project';
    setOverrideName(trimmed);
    setIsEditing(false);
    updateProjectName(activeProjectId, trimmed);
    if (onProjectRenamed) onProjectRenamed(activeProjectId, trimmed);
    appEvents.emit('project-renamed', { id: activeProjectId, name: trimmed });
  };

  const userInitial = (currentUser?.name || currentUser?.email || 'K').trim()[0].toUpperCase();

  return (
    <div className={`top-nav${isWorkspaceMode ? ' top-nav-workspace' : ''}`} role="banner">
      {/* LEFT: Logo / User / Project name / New */}
      <div className="top-nav-left-cluster">
        {onGoHome && (
          <button onClick={onGoHome} className="studio-workspace-brand" title="Return to Home" aria-label="Return to Home">
            <BrainHalfLogo size={26} color="currentColor" strokeWidth={1.6} />
          </button>
        )}
        {isWorkspaceMode && <span className="studio-nav-divider" aria-hidden="true">/</span>}
        {isWorkspaceMode && (
          <span className="top-nav-user-chip" aria-hidden="true">{userInitial}</span>
        )}
        {isWorkspaceMode && <span className="studio-nav-divider" aria-hidden="true">/</span>}
        <div className="top-nav-project-tab">
          {isEditing ? (
            <div className="studio-project-rename">
              <input type="text" value={editedName} onChange={event => setEditedName(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') handleSaveName();
                  if (event.key === 'Escape') setIsEditing(false);
                }} autoFocus aria-label="Rename project input" />
              <button onClick={handleSaveName} title="Save name" aria-label="Save name"><Check size={15} /></button>
            </div>
          ) : (
            <span className="studio-control-tooltip-anchor studio-project-rename-anchor"
              onMouseEnter={() => setShowProjectTooltip(projectTitleTruncated)}
              onMouseLeave={() => setShowProjectTooltip(false)}
              onFocus={() => setShowProjectTooltip(projectTitleTruncated)}
              onBlur={() => setShowProjectTooltip(false)}
            >
              <button
                ref={projectNameButtonRef}
                className="top-nav-project-name-button"
                type="button"
                aria-label={`Rename project ${projectName}`}
                aria-describedby={showProjectTooltip && projectTitleTruncated ? projectTooltipId : undefined}
                onClick={() => { setIsEditing(true); setEditedName(projectName); }}
                title="Click to rename"
              >
                {projectName}
                <Pencil size={11} className="top-nav-rename-hint" aria-hidden="true" />
              </button>
              {showProjectTooltip && projectTitleTruncated && (
                <span role="tooltip" id={projectTooltipId} className="studio-control-tooltip">
                  {projectName}
                </span>
              )}
            </span>
          )}
        </div>
        <button
          type="button"
          className="top-nav-new-project-btn icon-btn"
          onClick={() => onNewProject ? onNewProject() : onGoHome?.()}
          title="New project"
          aria-label="New project"
          disabled={creatingProject}
          aria-disabled={creatingProject}
        ><Plus size={16} strokeWidth={1.7} /></button>
      </div>

      {/* CENTER: Workspace tabs + preview URL bar (Bolt-style) */}
      {isWorkspaceMode && !isMobile && (
        <div className="top-nav-center-cluster">
          <div className="bolt-tabs" role="tablist" aria-label="Workspace view">
            <button role="tab" type="button" aria-selected={activeTab === 'preview'} className={`bolt-tab${activeTab === 'preview' ? ' active' : ''}`} onClick={() => onSelectTab?.('preview')}>
              <Monitor size={14} strokeWidth={1.75} /><span>Preview</span>
            </button>
            <button role="tab" type="button" aria-selected={activeTab === 'code'} className={`bolt-tab${activeTab === 'code' ? ' active' : ''}`} onClick={() => onSelectTab?.('code')}>
              <Code2 size={14} strokeWidth={1.75} /><span>Code</span>
            </button>
            <button role="tab" type="button" aria-selected={activeTab === 'console'} className={`bolt-tab${activeTab === 'console' ? ' active' : ''}`} onClick={() => onSelectTab?.('console')}>
              <Terminal size={14} strokeWidth={1.75} /><span>Terminal</span>
            </button>
          </div>

          {/* Viewport + URL bar — only when in Preview tab */}
          {activeTab === 'preview' && (
            <div className="bolt-url-bar-group">
              <div className="bolt-viewport-pills" role="group" aria-label="Preview screen size">
                {([
                  ['desktop', 'Desktop', Monitor],
                  ['tablet', 'Tablet', Tablet],
                  ['mobile', 'Mobile', Smartphone],
                ] as const).map(([value, label, Icon]) => (
                  <button key={value} type="button"
                    className={`bolt-viewport-btn${viewportMode === value ? ' active' : ''}`}
                    aria-label={label} title={label} aria-pressed={viewportMode === value}
                    onClick={() => onViewportMode?.(value)}
                  ><Icon size={14} strokeWidth={1.7} /></button>
                ))}
              </div>
              <div className="bolt-url-bar" aria-label="Preview URL">
                <span className="bolt-url-text">{previewUrl ? previewUrl.replace(/^https?:\/\/[^/]+/, '') || '/' : '/'}</span>
              </div>
              <div className="bolt-preview-tools">
                {onInspect && (
                  <button type="button" className={`bolt-icon-btn${inspectActive ? ' active' : ''}`}
                    title={inspectActive ? 'Cancel selection' : 'Inspect element'}
                    aria-label="Inspect element" disabled={!previewReady} onClick={onInspect}
                  ><MousePointer2 size={14} /></button>
                )}
                <button type="button" className="bolt-icon-btn" title="Refresh preview" aria-label="Refresh preview"
                  disabled={!previewReady} onClick={onRefreshPreview}><RotateCcw size={14} /></button>
                <button type="button" className="bolt-icon-btn" title="Open in new tab" aria-label="Open preview in new tab"
                  disabled={!openPreviewReady} onClick={onOpenPreview}><ArrowUpRight size={14} /></button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mobile tabs */}
      {isMobile && onSelectMobileTab && (
        <div className="segmented-control studio-mobile-tabs" style={{ padding: '2px', flexShrink: 0 }}>
          <button className={`segmented-tab ${mobileTab === 'chat' ? 'active' : ''}`} onClick={() => onSelectMobileTab('chat')} aria-pressed={mobileTab === 'chat'} style={{ padding: '4px 10px', fontSize: '11.5px' }}>
            <Bot size={16} strokeWidth={1.75} /><span>Chat</span>
          </button>
          <button className={`segmented-tab ${mobileTab === 'code' ? 'active' : ''}`} onClick={() => onSelectMobileTab('code')} aria-pressed={mobileTab === 'code'} style={{ padding: '4px 10px', fontSize: '11.5px' }}>
            <Code2 size={16} strokeWidth={1.75} /><span>Code</span>
          </button>
          <button className={`segmented-tab ${mobileTab === 'preview' ? 'active' : ''}`} onClick={() => onSelectMobileTab('preview')} aria-pressed={mobileTab === 'preview'} style={{ padding: '4px 10px', fontSize: '11.5px' }}>
            <Play size={16} strokeWidth={1.75} /><span>Preview</span>
          </button>
        </div>
      )}

      {/* RIGHT: Settings / Share / Publish + user menu */}
      <div className="top-nav-right-cluster">
        {isWorkspaceMode && !isMobile && (
          <>
            <ActionMenu label="Project actions" className="studio-project-actions" items={[
              { label: 'View code', icon: <Code2 size={14} />, onSelect: () => onSelectTab?.('code'), disabled: !hasFiles },
              { label: 'Project console', icon: <Server size={14} />, onSelect: () => onSelectTab?.('console'), separator: true },
              { label: 'Download ZIP', icon: <Download size={14} />, onSelect: () => onExportZip?.(), disabled: !hasFiles },
              { label: 'Export to GitHub', icon: <GitBranch size={14} />, onSelect: () => onExportGithub?.(), disabled: !hasFiles, separator: true },
              { label: 'Help & guides', icon: <HelpCircle size={14} />, onSelect: () => { window.open('/guides/build-an-app-with-ai', '_blank', 'noopener,noreferrer'); } },
              { label: 'Reset workspace', icon: <RotateCcw size={14} />, onSelect: () => onResetWorkspace?.(), danger: true, separator: true },
            ]}><Settings size={16} strokeWidth={1.75} /></ActionMenu>

            <button type="button" className="bolt-action-btn" onClick={onShare}
              title="Copy project link" aria-label="Copy project link">
              <Share2 size={14} strokeWidth={1.75} />
              <span>{shareCopied ? 'Copied!' : 'Share'}</span>
            </button>

            <div style={{ position: 'relative' }}>
              <button type="button"
                className={`bolt-publish-btn${hasGeneratedApp ? ' ready' : ''}`}
                disabled={!hasGeneratedApp}
                aria-haspopup="dialog"
                aria-expanded={publishOpen}
                onClick={onPublish}
                title={hasGeneratedApp ? 'Put your app on the web' : 'Generate an app in chat first'}
                aria-label={hasGeneratedApp ? 'Publish app' : 'Generate an app first'}
              >
                <Cloud size={14} strokeWidth={2} />
                <span>Publish</span>
              </button>
              {publishPopoverSlot}
            </div>
          </>
        )}

        {!isWorkspaceMode && <ThemeToggle />}

        <ActionMenu label="User profile and menu" className="studio-account-trigger" items={[
          ...(onOpenDashboard ? [{ label: 'Dashboard', icon: <LayoutDashboard size={15} />, onSelect: onOpenDashboard }] : []),
          { label: 'Gallery', icon: <LayoutGrid size={15} />, onSelect: () => { window.location.assign('/gallery'); } },
          ...(onGoHome ? [{ label: 'Back to home', icon: <Home size={15} />, onSelect: onGoHome }] : []),
          { label: theme === 'light' ? 'Dark mode' : 'Light mode', icon: theme === 'light' ? <Moon size={15} /> : <Sun size={15} />, onSelect: () => setTheme(theme === 'light' ? 'dark' : 'light') },
          ...(onLogout ? [{ label: 'Sign out', icon: <LogOut size={15} />, onSelect: () => { void onLogout(); }, separator: true }] : []),
        ]}>
          <span className="studio-account-avatar">{userInitial}</span>
          {!isMobile && !isWorkspaceMode && <span className="studio-account-name">{currentUser?.name || currentUser?.email || 'Account'}</span>}
          {!isMobile && !isWorkspaceMode && <ChevronDown size={13} />}
          {isWorkspaceMode && <ChevronDown size={13} />}
        </ActionMenu>
      </div>
    </div>
  );
};

export default TopNav;
