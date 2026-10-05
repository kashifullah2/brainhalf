import React, { useState, useEffect, useRef, useId, useMemo } from 'react';
import { Check, Code2, Plus, LogOut, ChevronDown, Home, LayoutDashboard, LayoutGrid, Pencil, Moon, Sun, Monitor, Tablet, Smartphone, RotateCcw, ArrowUpRight, Share2, Cloud, Settings, Terminal, Download, GitBranch, HelpCircle, MousePointer2, Globe2, Copy } from 'lucide-react';
import { appEvents } from '../lib/events';
import { getProjects, updateProjectName } from '../lib/project-store';
import { setTheme, useTheme } from '../lib/theme';
import ActionMenu from './ActionMenu';
import BrainHalfLogo from './BrainHalfLogo';
import ThemeToggle from './ThemeToggle';

type WorkspaceTab = 'code' | 'preview' | 'console' | 'logs' | 'terminal';
type ViewportMode = 'desktop' | 'tablet' | 'mobile';

interface TopNavProps {
  activeProjectId: string;
  onProjectRenamed?: (id: string, name: string) => void;
  onSelectProject?: (id: string) => void;
  mobileTab?: 'chat' | WorkspaceTab;
  onSelectMobileTab?: (tab: 'chat' | WorkspaceTab) => void;
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
  shareCopied?: boolean;
  onShare?: () => void;
  publishOpen?: boolean;
  onPublish?: () => void;
  publishBlockedReason?: string;
  onExportZip?: () => void;
  onExportGithub?: () => void;
  onResetWorkspace?: () => void;
  hasFiles?: boolean;
  inspectActive?: boolean;
  onInspect?: () => void;
  liveUrl?: string;
  publishPopoverSlot?: React.ReactNode;
}

/** Compact badge shown in the topbar when the app has a live production URL. */
function LiveUrlBadge({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const display = url.replace(/^https?:\/\//, '');
  const short = display.length > 30 ? display.slice(0, 27) + '…' : display;
  return (
    <div className="live-url-badge" title={url}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="live-url-badge-link"
        aria-label={`Open live app: ${display}`}
      >
        <Globe2 size={12} strokeWidth={1.75} />
        <span>{short}</span>
        <ArrowUpRight size={11} strokeWidth={1.75} className="live-url-badge-arrow" />
      </a>
      <button
        type="button"
        className="live-url-badge-copy"
        aria-label="Copy live app URL"
        title="Copy live URL"
        onClick={async e => {
          e.stopPropagation();
          try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
          catch { /* clipboard unavailable */ }
        }}
      >
        {copied ? <Check size={11} strokeWidth={2} /> : <Copy size={11} strokeWidth={1.75} />}
      </button>
    </div>
  );
}

const TopNav: React.FC<TopNavProps> = ({
  activeProjectId,
  onProjectRenamed,
  onSelectProject: _onSelectProject,
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
  shareCopied = false,
  onShare,
  publishOpen = false,
  onPublish,
  publishBlockedReason,
  onExportZip,
  onExportGithub,
  onResetWorkspace,
  hasFiles = false,
  inspectActive = false,
  onInspect,
  liveUrl,
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

  // Only re-read the project list when the active project ID changes or the
  // override name is cleared (project switch). The override state handles
  // in-session renames so we don't need to re-scan on every streaming render.
  const currentProjectName = useMemo(
    () => getProjects().find(p => p.id === activeProjectId)?.name || 'Untitled Project',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeProjectId, overrideName === null],
  );

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

      {/* LEFT: Logo / project name / new */}
      <div className="top-nav-left-cluster">
        {onGoHome && (
          <button onClick={onGoHome} className="studio-workspace-brand" title="Return to Home" aria-label="Return to Home">
            <BrainHalfLogo size={22} color="currentColor" strokeWidth={1.6} />
            {!isWorkspaceMode && <span>BrainHalf</span>}
          </button>
        )}
        {isWorkspaceMode && <span className="studio-nav-divider" aria-hidden="true">/</span>}
        <div className="top-nav-project-tab">
          {isEditing ? (
            <div className="studio-project-rename">
              <input type="text" value={editedName} onChange={e => setEditedName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setIsEditing(false); }}
                autoFocus aria-label="Rename project input" />
              <button onClick={handleSaveName} title="Save" aria-label="Save name"><Check size={14} /></button>
            </div>
          ) : (
            <span className="studio-control-tooltip-anchor studio-project-rename-anchor"
              onMouseEnter={() => setShowProjectTooltip(projectTitleTruncated)}
              onMouseLeave={() => setShowProjectTooltip(false)}
              onFocus={() => setShowProjectTooltip(projectTitleTruncated)}
              onBlur={() => setShowProjectTooltip(false)}
            >
              <button ref={projectNameButtonRef} className="top-nav-project-name-button" type="button"
                aria-label={`Rename project ${projectName}`}
                aria-describedby={showProjectTooltip && projectTitleTruncated ? projectTooltipId : undefined}
                onClick={() => { setIsEditing(true); setEditedName(projectName); }} title="Click to rename"
              >
                {projectName}
                <Pencil size={11} className="top-nav-rename-hint" aria-hidden="true" />
              </button>
              {showProjectTooltip && projectTitleTruncated && (
                <span role="tooltip" id={projectTooltipId} className="studio-control-tooltip">{projectName}</span>
              )}
            </span>
          )}
        </div>
        {isWorkspaceMode && (
          <button type="button" className="top-nav-new-project-btn icon-btn"
            onClick={() => onNewProject ? onNewProject() : onGoHome?.()}
            title="Create new project" aria-label="Create new project"
            disabled={creatingProject} aria-disabled={creatingProject}
          ><Plus size={15} strokeWidth={1.7} /></button>
        )}
      </div>

      {/* CENTER: Workspace tabs + preview action icons */}
      {isWorkspaceMode && !isMobile && (
        <div className="top-nav-center-cluster">
          <div className="bolt-tabs" role="tablist" aria-label="Workspace view">
            <button role="tab" type="button" aria-selected={activeTab === 'preview'}
              className={`bolt-tab${activeTab === 'preview' ? ' active' : ''}`}
              onClick={() => onSelectTab?.('preview')}>
              <Monitor size={13} strokeWidth={1.75} /><span>Preview</span>
            </button>
            <button role="tab" type="button" aria-selected={activeTab === 'code'}
              className={`bolt-tab${activeTab === 'code' ? ' active' : ''}`}
              onClick={() => onSelectTab?.('code')} title="Switch to code editor" aria-label="Switch to code editor">
              <Code2 size={13} strokeWidth={1.75} /><span>Code</span>
            </button>
          </div>

          {/* Refresh + open — only when Preview is active */}
          {activeTab === 'preview' && (
            <div className="bolt-preview-icon-group">
              {/* Viewport size — moved to top bar for one-click access */}
              {onViewportMode && previewReady && (
                <div className="viewport-segmented-control topbar-viewport" role="group" aria-label="Preview screen size">
                  {([
                    ['desktop', 'Desktop', Monitor],
                    ['tablet', 'Tablet', Tablet],
                    ['mobile', 'Mobile', Smartphone],
                  ] as const).map(([value, label, Icon]) => (
                    <button type="button" key={value}
                      className={`viewport-pill-btn${viewportMode === value ? ' active' : ''}`}
                      aria-label={label} title={label} aria-pressed={viewportMode === value}
                      onClick={() => onViewportMode(value)}>
                      <Icon size={14} strokeWidth={1.7} />
                    </button>
                  ))}
                </div>
              )}
              {onInspect && (
                <button type="button" className={`bolt-icon-btn${inspectActive ? ' active' : ''}`}
                  title={inspectActive ? 'Cancel element selection' : 'Inspect element'}
                  aria-label="Inspect element" disabled={!previewReady} onClick={onInspect}>
                  <MousePointer2 size={13} />
                </button>
              )}
              <button type="button" className="bolt-icon-btn" title="Refresh preview"
                aria-label="Refresh preview" disabled={!previewReady} onClick={onRefreshPreview}>
                <RotateCcw size={13} />
              </button>
              <button type="button" className="bolt-icon-btn" title="Open preview in new tab"
                aria-label="Open preview in new tab" disabled={!openPreviewReady} onClick={onOpenPreview}>
                <ArrowUpRight size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* RIGHT: Settings menu + Publish CTA + user menu */}
      <div className="top-nav-right-cluster">
        {isWorkspaceMode && !isMobile && (
          <>
            {/* Settings: all project actions + share consolidated here */}
            <ActionMenu label="Project actions" className="studio-project-actions" items={[
              { label: 'View code', icon: <Code2 size={14} />, onSelect: () => onSelectTab?.('code'), disabled: !hasFiles },
              { label: 'Terminal / console', icon: <Terminal size={14} />, onSelect: () => onSelectTab?.('console'), separator: true },
              {
                label: shareCopied ? 'Link copied!' : 'Copy project link',
                icon: <Share2 size={14} />,
                onSelect: () => onShare?.(),
                separator: true,
              },
              { label: 'Download ZIP', icon: <Download size={14} />, onSelect: () => onExportZip?.(), disabled: !hasFiles },
              { label: 'Export to GitHub', icon: <GitBranch size={14} />, onSelect: () => onExportGithub?.(), disabled: !hasFiles, separator: true },
              { label: 'Help & guides', icon: <HelpCircle size={14} />, onSelect: () => window.open('/guides/build-an-app-with-ai', '_blank', 'noopener,noreferrer') },
              { label: 'Reset workspace', icon: <RotateCcw size={14} />, onSelect: () => onResetWorkspace?.(), danger: true, separator: true },
            ]}>
              <Settings size={15} strokeWidth={1.75} />
            </ActionMenu>

            {/* Live URL badge — shown when the app is published */}
            {liveUrl && (
              <LiveUrlBadge url={liveUrl} />
            )}

            {/* Publish — primary CTA, always visible */}
            <div style={{ position: 'relative' }}>
              <button type="button"
                className={`bolt-publish-btn${hasGeneratedApp ? ' ready' : ''}`}
                disabled={!hasGeneratedApp || !!publishBlockedReason}
                aria-haspopup="dialog"
                aria-expanded={publishOpen}
                onClick={onPublish}
                title={publishBlockedReason || (hasGeneratedApp ? 'Put your app on the web' : 'Generate an app in chat first')}
                aria-label={publishBlockedReason || (hasGeneratedApp ? 'Publish app' : 'Generate an app first')}
              >
                <Cloud size={13} strokeWidth={2} />
                <span>{liveUrl ? 'Update' : 'Publish'}</span>
              </button>
              {publishPopoverSlot}
            </div>
          </>
        )}

        {!isWorkspaceMode && <ThemeToggle />}

        <ActionMenu label="User profile and menu" className="studio-account-trigger" items={[
          ...(onOpenDashboard ? [{ label: 'Dashboard', icon: <LayoutDashboard size={15} />, onSelect: onOpenDashboard }] : []),
          { label: 'Gallery', icon: <LayoutGrid size={15} />, onSelect: () => window.location.assign('/gallery') },
          ...(onGoHome ? [{ label: 'Back to home', icon: <Home size={15} />, onSelect: onGoHome }] : []),
          { label: theme === 'light' ? 'Dark mode' : 'Light mode', icon: theme === 'light' ? <Moon size={15} /> : <Sun size={15} />, onSelect: () => setTheme(theme === 'light' ? 'dark' : 'light') },
          ...(onLogout ? [{ label: 'Sign out', icon: <LogOut size={15} />, onSelect: () => { void onLogout(); }, separator: true }] : []),
        ]}>
          <span className="studio-account-avatar">{userInitial}</span>
          {!isMobile && !isWorkspaceMode && <span className="studio-account-name">{currentUser?.name || currentUser?.email || 'Account'}</span>}
          <ChevronDown size={12} />
        </ActionMenu>
      </div>
    </div>
  );
};

export default TopNav;
