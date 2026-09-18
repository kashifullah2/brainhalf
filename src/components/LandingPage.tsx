import React, { useState, useEffect, useRef } from 'react';
import {
  LayoutGrid,
  Globe,
  Smartphone,
  Plus,
  Mic,
  ArrowUp,
  Award,
  Monitor,
  Radio,
  MoreHorizontal,
  Trash2,
  Edit2,
  LogOut,
  FolderOpen
} from 'lucide-react';
import {
  Project,
  getProjects,
  deleteProject,
  updateProjectName,
  formatRelativeTime,
} from '../lib/project-store';
import { appEvents } from '../lib/events';
import ConfirmModal from './ConfirmModal';
import BrainHalfLogo from './BrainHalfLogo';

interface LandingPageProps {
  onOpenProject: (projectId: string) => void;
  onSubmitInitialPrompt: (prompt: string, appType: 'web' | 'mobile') => void;
  activeProjectId?: string;
  currentUser?: { email?: string; name?: string } | null;
  onLogout?: () => void | Promise<void>;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onOpenProject,
  onSubmitInitialPrompt,
  activeProjectId,
  currentUser,
  onLogout,
}) => {
  const [projects, setProjects] = useState<Project[]>(() => getProjects());
  const [promptText, setPromptText] = useState('');
  const [appType, setAppType] = useState<'web' | 'mobile'>('web');
  const [activeFilter, setActiveFilter] = useState<'all' | 'apps' | 'published'>('all');
  const [activeMenuProjectId, setActiveMenuProjectId] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [projectToRename, setProjectToRename] = useState<Project | null>(null);
  const [renamedName, setRenamedName] = useState('');
  const [showUserMenu, setShowUserMenu] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const refreshProjects = () => {
    setProjects(getProjects());
  };

  useEffect(() => {
    const unsub1 = appEvents.on('project-renamed', refreshProjects);
    const unsub2 = appEvents.on('project-messages-updated', refreshProjects);
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenuProjectId(null);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handlePromptSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = promptText.trim();
    if (!trimmed) return;
    onSubmitInitialPrompt(trimmed, appType);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handlePromptSubmit();
    }
  };

  const handleDeleteConfirm = () => {
    if (!projectToDelete) return;
    const remaining = deleteProject(projectToDelete);
    setProjects(remaining);
    setProjectToDelete(null);
    setActiveMenuProjectId(null);
  };

  const handleRenameSave = () => {
    if (!projectToRename) return;
    const trimmed = renamedName.trim();
    if (trimmed) {
      updateProjectName(projectToRename.id, trimmed);
      refreshProjects();
    }
    setProjectToRename(null);
  };

  const activeProject = projects.find(p => p.id === activeProjectId) || projects[0];

  const filteredProjects = projects.filter(p => {
    if (activeFilter === 'apps') return true;
    if (activeFilter === 'published') return p.status === 'ready';
    return true;
  });

  const userInitial = (currentUser?.name || currentUser?.email || 'W')
    .trim()[0]
    .toUpperCase();

  return (
    <div className="landing-container">
      {/* Background dark atmosphere */}
      <div className="landing-sky-backdrop" />

      {/* Top Bar */}
      <header className="landing-header">
        <div className="landing-header-left">
          <button className="landing-home-pill" title="Home" aria-label="Home">
            <LayoutGrid size={15} strokeWidth={2} />
            <span>Home</span>
          </button>
          {activeProject && (
            <div
              className="landing-project-breadcrumb"
              onClick={() => onOpenProject(activeProject.id)}
              role="button"
              tabIndex={0}
              title={`Active Project: ${activeProject.name}`}
            >
              <span className="landing-breadcrumb-dot" />
              <span className="landing-breadcrumb-name">{activeProject.name}</span>
            </div>
          )}
        </div>

        <div className="landing-header-right">
          {/* Credit balance badge */}
          <div className="landing-credits-badge" title="BrainHalf AI Credits">
            <span className="landing-credits-icon">✦</span>
            <span className="landing-credits-value">-0.34</span>
          </div>

          {/* User Avatar & Dropdown */}
          <div style={{ position: 'relative' }} ref={userMenuRef}>
            <button
              className="landing-user-avatar"
              onClick={() => setShowUserMenu(prev => !prev)}
              title={currentUser?.email || 'User Profile'}
              aria-label="User Profile"
            >
              <span>{userInitial}</span>
            </button>

            {showUserMenu && (
              <div className="landing-user-dropdown">
                <div className="landing-user-dropdown-info">
                  <p className="user-email">{currentUser?.email || 'user@brainhalf.com'}</p>
                  <p className="user-status">Free Developer Tier</p>
                </div>
                <hr className="landing-dropdown-divider" />
                {onLogout && (
                  <button
                    className="landing-dropdown-item"
                    onClick={() => {
                      setShowUserMenu(false);
                      onLogout();
                    }}
                  >
                    <LogOut size={14} />
                    <span>Sign Out</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Hero Section */}
      <main className="landing-main-content">
        <h1 className="landing-headline">
          Start with one prompt. You can change everything later.
        </h1>

        {/* Prompt Card with Docked Tabs */}
        <div className="landing-prompt-wrapper">
          {/* App Type Tabs */}
          <div className="landing-tabs-bar">
            <button
              type="button"
              className={`landing-type-tab ${appType === 'web' ? 'active' : ''}`}
              onClick={() => setAppType('web')}
            >
              <Globe size={14} strokeWidth={1.8} />
              <span>Web app</span>
            </button>
            <button
              type="button"
              className={`landing-type-tab ${appType === 'mobile' ? 'active' : ''}`}
              onClick={() => setAppType('mobile')}
            >
              <Smartphone size={14} strokeWidth={1.8} />
              <span>Mobile app</span>
            </button>
          </div>

          {/* Main Prompt Box */}
          <form className="landing-prompt-box" onSubmit={handlePromptSubmit}>
            <textarea
              ref={textareaRef}
              className="landing-prompt-textarea"
              placeholder="Describe your idea we will bring it to life.."
              value={promptText}
              onChange={e => setPromptText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
            />

            <div className="landing-prompt-toolbar">
              <div className="landing-prompt-tools-left">
                <button
                  type="button"
                  className="landing-tool-btn"
                  title="Add files or context"
                  aria-label="Add files or context"
                  onClick={() => textareaRef.current?.focus()}
                >
                  <Plus size={16} strokeWidth={2} />
                </button>
              </div>

              <div className="landing-prompt-tools-right">
                <button
                  type="button"
                  className="landing-tool-btn"
                  title="Voice input"
                  aria-label="Voice input"
                >
                  <Mic size={15} strokeWidth={2} />
                </button>

                <button
                  type="submit"
                  className={`landing-submit-btn ${promptText.trim() ? 'active' : ''}`}
                  disabled={!promptText.trim()}
                  title="Create app from prompt"
                  aria-label="Create app from prompt"
                >
                  <ArrowUp size={16} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </form>

          {/* Announcement Banner */}
          <div className="landing-fest-banner">
            <div className="landing-fest-left">
              <div className="landing-fest-icon">
                <Award size={18} strokeWidth={2} color="#fbbf24" />
              </div>
              <span className="landing-fest-text">
                Builder Fest: Participate & win up to $100K!
              </span>
            </div>
            <a
              href="#fest"
              className="landing-fest-link"
              onClick={e => {
                e.preventDefault();
                alert('Welcome to BrainHalf Builder Fest! Deploy full-stack edge applications to participate.');
              }}
            >
              View invite →
            </a>
          </div>
        </div>

        {/* Filter Segmented Control */}
        <div className="landing-filters-row">
          <div className="landing-segmented-filter">
            <button
              className={`landing-filter-btn ${activeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setActiveFilter('all')}
            >
              <LayoutGrid size={13} strokeWidth={2} />
              <span>All ({projects.length})</span>
            </button>
            <button
              className={`landing-filter-btn ${activeFilter === 'apps' ? 'active' : ''}`}
              onClick={() => setActiveFilter('apps')}
            >
              <Monitor size={13} strokeWidth={2} />
              <span>Apps</span>
            </button>
            <button
              className={`landing-filter-btn ${activeFilter === 'published' ? 'active' : ''}`}
              onClick={() => setActiveFilter('published')}
            >
              <Radio size={13} strokeWidth={2} />
              <span>Published</span>
            </button>
          </div>
        </div>

        {/* Project Cards List / Grid */}
        <div className="landing-projects-section">
          {filteredProjects.length === 0 ? (
            <div className="landing-empty-projects">
              <p>No projects in this category.</p>
            </div>
          ) : (
            <div className="landing-projects-list">
              {filteredProjects.map(proj => (
                <div
                  key={proj.id}
                  className="landing-project-card"
                  onClick={() => onOpenProject(proj.id)}
                >
                  {/* Miniature App Wireframe Preview */}
                  <div className="landing-card-thumbnail">
                    <div className="thumbnail-window">
                      <div className="thumb-header">
                        <div className="thumb-dots">
                          <span />
                          <span />
                          <span />
                        </div>
                        <div className="thumb-url-bar" />
                      </div>
                      <div className="thumb-body">
                        <div className="thumb-sidebar" />
                        <div className="thumb-content">
                          <div className="thumb-box-1" />
                          <div className="thumb-box-2" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Project Info */}
                  <div className="landing-card-info">
                    <h3 className="landing-card-title">{proj.name}</h3>
                    <p className="landing-card-time">
                      Updated {formatRelativeTime(proj.updatedAt)}
                    </p>
                  </div>

                  {/* Actions Menu */}
                  <div
                    className="landing-card-actions"
                    onClick={e => e.stopPropagation()}
                    ref={activeMenuProjectId === proj.id ? menuRef : undefined}
                  >
                    <button
                      className="landing-card-menu-btn"
                      onClick={e => {
                        e.stopPropagation();
                        setActiveMenuProjectId(prev => (prev === proj.id ? null : proj.id));
                      }}
                      title="Project actions"
                      aria-label="Project actions"
                    >
                      <MoreHorizontal size={16} />
                    </button>

                    {activeMenuProjectId === proj.id && (
                      <div className="landing-card-dropdown" onClick={e => e.stopPropagation()}>
                        <button
                          className="landing-card-dropdown-item"
                          onClick={() => {
                            setActiveMenuProjectId(null);
                            onOpenProject(proj.id);
                          }}
                        >
                          <FolderOpen size={14} />
                          <span>Open in Workspace</span>
                        </button>
                        <button
                          className="landing-card-dropdown-item"
                          onClick={() => {
                            setActiveMenuProjectId(null);
                            setProjectToRename(proj);
                            setRenamedName(proj.name);
                          }}
                        >
                          <Edit2 size={14} />
                          <span>Rename</span>
                        </button>
                        <hr className="landing-dropdown-divider" />
                        <button
                          className="landing-card-dropdown-item danger"
                          onClick={() => {
                            setActiveMenuProjectId(null);
                            setProjectToDelete(proj.id);
                          }}
                        >
                          <Trash2 size={14} />
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Floating Bot Icon on Bottom-right */}
      <button
        className="landing-floating-bot-btn"
        title="BrainHalf Assistant"
        aria-label="BrainHalf Assistant"
        onClick={() => {
          if (activeProject) onOpenProject(activeProject.id);
        }}
      >
        <div className="floating-bot-inner">
          <BrainHalfLogo size={22} color="#000" strokeWidth={2.2} />
        </div>
      </button>

      {/* Delete Confirmation Modal */}
      {projectToDelete && (
        <ConfirmModal
          isOpen={true}
          title="Delete Project"
          message="Are you sure you want to delete this project? All project files and conversation history will be permanently deleted."
          confirmLabel="Delete Project"
          isDestructive={true}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setProjectToDelete(null)}
        />
      )}

      {/* Rename Modal */}
      {projectToRename && (
        <div className="modal-backdrop" onClick={() => setProjectToRename(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 600 }}>Rename Project</h3>
            <input
              type="text"
              value={renamedName}
              onChange={e => setRenamedName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleRenameSave();
                if (e.key === 'Escape') setProjectToRename(null);
              }}
              autoFocus
              className="text-input"
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '6px',
                background: '#1a1c26',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-primary)',
                marginBottom: '16px',
                outline: 'none'
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button className="button-secondary" onClick={() => setProjectToRename(null)}>
                Cancel
              </button>
              <button className="button-primary" onClick={handleRenameSave}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LandingPage;
