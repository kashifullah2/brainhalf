import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Mic,
  ArrowUp,
  ArrowRight,
  Sparkles,
  MoreHorizontal,
  Trash2,
  Edit2,
  LogOut,
  FolderOpen,
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
import { BrainHalfLogo } from './BrainHalfLogo';

interface LandingPageProps {
  onOpenProject: (projectId: string) => void;
  onSubmitInitialPrompt: (prompt: string, appType: 'web' | 'mobile') => void;
  activeProjectId?: string;
  currentUser?: { email?: string; name?: string } | null;
  onLogout?: () => void | Promise<void>;
  onLoginRequest?: (mode?: 'login' | 'signup') => void;
}

const SUGGESTIONS = [
  { label: 'SaaS analytics dashboard', prompt: 'Build a SaaS analytics dashboard with MRR cards, revenue charts, and user retention tables.' },
  { label: 'Real-time kanban board', prompt: 'Create a kanban board with drag-and-drop task cards, priority labels, and search filters.' },
  { label: 'Crypto portfolio tracker', prompt: 'Build a cryptocurrency portfolio tracker with live prices for BTC/ETH/SOL and an allocation chart.' },
  { label: 'E-commerce storefront', prompt: 'Build a modern e-commerce storefront with a product grid, cart, and checkout flow.' },
];

export const LandingPage: React.FC<LandingPageProps> = ({
  onOpenProject,
  onSubmitInitialPrompt,
  activeProjectId,
  currentUser,
  onLogout,
  onLoginRequest,
}) => {
  const [projects, setProjects] = useState<Project[]>(() => getProjects());
  const [promptText, setPromptText] = useState('');
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
    onSubmitInitialPrompt(trimmed, 'web');
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

  const userInitial = (currentUser?.name || currentUser?.email || 'U')
    .trim()[0]
    .toUpperCase();

  return (
    <div className="landing-container">
      <div className="landing-radial-glow" />

      {/* Nav */}
      <header className="landing-header">
        <div className="landing-header-left">
          <div
            className="landing-brand-group"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            role="button"
            tabIndex={0}
          >
            <div className="landing-brand-logo">
              <BrainHalfLogo size={20} strokeWidth={1.8} color="#2dd4bf" />
            </div>
            <span className="landing-brand-text">BrainHalf</span>
          </div>

          {currentUser && activeProject && (
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
          {currentUser ? (
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
          ) : (
            <div className="landing-auth-buttons">
              <button
                type="button"
                className="landing-signin-btn"
                onClick={() => onLoginRequest?.('login')}
              >
                Sign in
              </button>
              <button
                type="button"
                className="landing-get-started-btn"
                onClick={() => onLoginRequest?.('signup')}
              >
                <Sparkles size={14} className="landing-sparkle-icon" />
                <span>Get Started</span>
                <ArrowRight size={13} />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Hero */}
      <main className="landing-main-content">
        <h1 className="landing-headline">
          What would you like to <span className="landing-headline-gradient">build today?</span>
        </h1>
        <p className="landing-subheadline">
          Describe your idea and watch it come to life.
        </p>

        {/* Prompt Box */}
        <div className="landing-prompt-wrapper">
          <form className="landing-prompt-box" onSubmit={handlePromptSubmit}>
            <textarea
              ref={textareaRef}
              className="landing-prompt-textarea"
              placeholder="Describe an app idea, e.g. 'Build a crypto portfolio tracker with real-time prices and charts'"
              value={promptText}
              onChange={e => setPromptText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={3}
              style={{
                outline: 'none',
                border: 'none',
                boxShadow: 'none',
                WebkitTapHighlightColor: 'transparent',
              }}
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
                  title="Create app from prompt (Enter)"
                  aria-label="Create app from prompt"
                >
                  <ArrowUp size={16} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </form>

          {/* Suggestion Chips */}
          <div className="landing-chips-container">
            <div className="landing-chips-scroll">
              {SUGGESTIONS.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="landing-chip-btn"
                  onClick={() => {
                    setPromptText(s.prompt);
                    textareaRef.current?.focus();
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Recent Projects */}
        {projects.length > 0 && (
          <section className="landing-projects-section" style={{ marginTop: '40px' }}>
            <h2 className="landing-section-title" style={{ fontSize: '14px', fontWeight: 500, color: 'rgba(255,255,255,0.45)', marginBottom: '12px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Recent projects</h2>

            <div className="landing-projects-list">
              {projects.map(proj => (
                <div
                  key={proj.id}
                  className="landing-project-card"
                  onClick={() => onOpenProject(proj.id)}
                >
                  <div className="landing-card-info">
                    <h3 className="landing-card-title">{proj.name}</h3>
                    <p className="landing-card-time">{formatRelativeTime(proj.updatedAt)}</p>
                  </div>

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
                          <span>Open</span>
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
          </section>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      {projectToDelete && (
        <ConfirmModal
          isOpen={true}
          title="Delete Project"
          message="Are you sure you want to delete this project? All files and conversation history will be permanently deleted."
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
