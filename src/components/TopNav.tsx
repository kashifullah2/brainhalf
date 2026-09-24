import ThemeToggle from './ThemeToggle';
import React, { useState, useEffect, useRef, useId } from 'react';
import { Play, Check, Bot, Code2, Plus, LogOut, ChevronDown, Home } from 'lucide-react';
import { appEvents } from '../lib/events';
import { getProjects, updateProjectName } from '../lib/project-store';
import ActionMenu from './ActionMenu';
import BrainHalfLogo from './BrainHalfLogo';

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
  onNewProject?: () => void;
  creatingProject?: boolean;
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
  creatingProject = false,
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
    <div className="top-nav" role="banner">
      <div className="top-nav-left-cluster">
        {onGoHome && (
          <button onClick={onGoHome} className="studio-workspace-brand" title="Return to Home" aria-label="Return to Home">
            <BrainHalfLogo size={26} color="currentColor" strokeWidth={1.6} />
            <span>BrainHalf</span>
          </button>
        )}
        <span className="studio-nav-divider" aria-hidden="true">/</span>
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
            <span className="studio-control-tooltip-anchor"
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
                title="Click to rename project"
              >
                {projectName}
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

      {isMobile && onSelectMobileTab && (
        <div className="segmented-control studio-mobile-tabs" style={{ padding: '2px', flexShrink: 0 }}>
          <button
            className={`segmented-tab ${mobileTab === 'chat' ? 'active' : ''}`}
            onClick={() => onSelectMobileTab('chat')}
            aria-pressed={mobileTab === 'chat'}
            style={{ padding: '4px 10px', fontSize: '11.5px' }}
          >
            <Bot size={16} strokeWidth={1.75} />
            <span>Chat</span>
          </button>
          <button
            className={`segmented-tab ${mobileTab === 'code' ? 'active' : ''}`}
            onClick={() => onSelectMobileTab('code')}
            aria-pressed={mobileTab === 'code'}
            style={{ padding: '4px 10px', fontSize: '11.5px' }}
          >
            <Code2 size={16} strokeWidth={1.75} />
            <span>Code</span>
          </button>
          <button
            className={`segmented-tab ${mobileTab === 'preview' ? 'active' : ''}`}
            onClick={() => onSelectMobileTab('preview')}
            aria-pressed={mobileTab === 'preview'}
            style={{ padding: '4px 10px', fontSize: '11.5px' }}
          >
            <Play size={16} strokeWidth={1.75} />
            <span>Preview</span>
          </button>
        </div>
      )}

      {/* Appearance and account actions */}
      <div className="top-nav-right-cluster" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0, marginLeft: 'auto' }}>
        <ThemeToggle />

        <ActionMenu label="User profile and menu" className="studio-account-trigger" items={[
          ...(onGoHome ? [{ label: 'Back to home', icon: <Home size={15} />, onSelect: onGoHome }] : []),
          ...(onLogout ? [{ label: 'Sign out', icon: <LogOut size={15} />, onSelect: () => { void onLogout(); }, separator: true }] : []),
        ]}>
          <span className="studio-account-avatar">{userInitial}</span>
          {!isMobile && <span className="studio-account-name">{currentUser?.name || currentUser?.email || 'Account'}</span>}
          <ChevronDown size={13} />
        </ActionMenu>
        {!isMobile && currentUser?.devMode && (
          <span
            title="Anonymous development mode is active on this deployment. Project isolation is disabled."
            style={{
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--color-warning)',
              background: 'rgba(234,179,8,0.1)',
              border: '1px solid rgba(234,179,8,0.3)',
              borderRadius: '9999px',
              padding: '3px 8px',
            }}
          >
            Dev
          </span>
        )}
      </div>


    </div>
  );
};

export default TopNav;
