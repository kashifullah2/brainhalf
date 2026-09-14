import React, { useState, useEffect } from 'react';
import { Sparkles, Settings, Plus, Layers, Trash2, X, Cpu, Server, PanelLeftClose, PanelLeftOpen, Code2, GitBranch, GitMerge, MoreHorizontal, Share2, Check, BrainCircuit } from 'lucide-react';
import { Project, getProjects, createProject, createBranch, mergeBranches, deleteProject, formatRelativeTime, getProjectDisplayTitle } from '../lib/project-store';
import { appEvents } from '../lib/events';
import ConfirmModal from './ConfirmModal';
import BrainHalfLogo from './BrainHalfLogo';

interface SidebarProps {
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeProjectId, onSelectProject, collapsed = false, onToggleCollapse, isMobileOpen = false, onCloseMobile }) => {
  const [projects, setProjects] = useState<Project[]>(() => getProjects());
  const [showSettings, setShowSettings] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [activeMenuProjectId, setActiveMenuProjectId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const refreshProjects = () => {
    setProjects(getProjects());
  };

  useEffect(() => {
    const unsubRenamed = appEvents.on('project-renamed', () => {
      refreshProjects();
    });
    const unsubMessages = appEvents.on('project-messages-updated', () => {
      refreshProjects();
    });

    return () => {
      unsubRenamed();
      unsubMessages();
    };
  }, []);

  // Keyboard navigation and click-outside for project menu & mobile drawer
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenuProjectId(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeMenuProjectId) {
          setActiveMenuProjectId(null);
        } else if (isMobileOpen && onCloseMobile) {
          onCloseMobile();
        } else if (showSettings) {
          setShowSettings(false);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeMenuProjectId, isMobileOpen, onCloseMobile, showSettings]);

  const handleNewProject = () => {
    const existingNames = new Set(projects.map(p => p.name));
    let counter = projects.length + 1;
    while (existingNames.has(`Project ${counter}`)) {
      counter++;
    }
    const newProj = createProject(`Project ${counter}`);
    refreshProjects();
    onSelectProject(newProj.id);
  };

  const handleBranchProject = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    setActiveMenuProjectId(null);
    const branchName = `${name} (Branch)`;
    const newProj = await createBranch(id, branchName);
    refreshProjects();
    onSelectProject(newProj.id);
  };

  const handleShareProject = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const shareUrl = `${window.location.origin}${window.location.pathname}?project=${id}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId(null);
        setActiveMenuProjectId(null);
      }, 1500);
    } catch {
      prompt('Copy project URL:', shareUrl);
      setActiveMenuProjectId(null);
    }
  };

  const handleMergeProject = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    setActiveMenuProjectId(null);
    const res = await mergeBranches(activeProjectId, id);
    refreshProjects();
    if (res.hasConflict) {
      appEvents.emit('generation-status', { 
        status: 'Error', 
        detail: `Merge conflict detected in: ${res.conflicts.join(', ')}` 
      });
      appEvents.emit('merge-conflict', {
        sourceId: id,
        sourceName: name,
        targetId: activeProjectId,
        conflicts: res.conflicts
      });
    } else {
      appEvents.emit('generation-status', { 
        status: 'Ready', 
        detail: `Cleanly merged ${name} into current project` 
      });
    }
  };

  const handleDeleteProject = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setActiveMenuProjectId(null);
    setProjectToDelete(id);
  };

  const handleConfirmDelete = () => {
    if (!projectToDelete) return;
    const remaining = deleteProject(projectToDelete);
    setProjects(remaining);
    if (activeProjectId === projectToDelete) {
      onSelectProject(remaining[0]?.id || 'default');
    }
    setProjectToDelete(null);
  };

  return (
    <>
      {isMobileOpen && (
        <div 
          className="sidebar-mobile-backdrop"
          onClick={onCloseMobile}
        />
      )}
      <div className={`sidebar-container ${collapsed ? 'collapsed' : ''} ${isMobileOpen ? 'mobile-open' : ''}`} role="navigation" aria-label="Projects Sidebar">
      {/* Brand Header & Toggle Button (48px height matching horizontal grid) */}
      <div style={{ 
        padding: collapsed ? '0 12px' : '0 16px', 
        marginBottom: '16px', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: collapsed ? 'center' : 'space-between',
        height: '48px',
        flexShrink: 0
      }}>
        {!collapsed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div className="sidebar-brand-badge" style={{ color: '#818cf8' }}>
              <BrainHalfLogo size={16} strokeWidth={1.75} />
            </div>
            <span style={{ 
              fontFamily: 'var(--font-sans)', 
              fontWeight: 600, 
              fontSize: '14px', 
              letterSpacing: '-0.2px',
              color: '#ffffff'
            }}>
              BrainHalf
            </span>
          </div>
        ) : (
          <div className="sidebar-brand-badge" onClick={onToggleCollapse} style={{ cursor: 'pointer', color: '#818cf8' }} title="Expand Sidebar" aria-label="Expand Sidebar">
            <BrainHalfLogo size={16} strokeWidth={1.75} />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {isMobileOpen && onCloseMobile && (
            <button 
              className="icon-btn" 
              onClick={onCloseMobile} 
              title="Close Sidebar"
              aria-label="Close Sidebar"
              style={{ color: 'var(--text-muted)', padding: '6px' }}
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          )}

          {onToggleCollapse && !collapsed && (
            <button 
              className="icon-btn" 
              onClick={onToggleCollapse} 
              title="Collapse Sidebar"
              aria-label="Collapse Sidebar"
              style={{ color: 'var(--text-muted)' }}
            >
              <PanelLeftClose size={16} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {/* Primary New Project Action */}
      <div style={{ padding: '0 12px', marginBottom: '14px' }}>
        <button 
          onClick={handleNewProject} 
          title={collapsed ? "New Project" : undefined}
          aria-label="Create New Project"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '7px',
            background: '#ffffff',
            color: '#09090b',
            border: 'none',
            borderRadius: '6px',
            padding: collapsed ? '8px' : '7px 12px',
            fontWeight: 600,
            fontSize: '12px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#f4f4f5';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#ffffff';
          }}
        >
          <Plus size={16} strokeWidth={1.75} />
          {!collapsed && <span>New project</span>}
        </button>
      </div>

      {/* Navigation / Recent Projects */}
      <div style={{ flex: 1, padding: '0 12px', display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto' }}>
        {!collapsed && (
          <div style={{ 
            fontSize: '11px', 
            color: 'var(--text-muted)', 
            textTransform: 'uppercase', 
            padding: '6px 8px 4px 8px', 
            fontWeight: 600,
            letterSpacing: '0.06em',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <Layers size={16} strokeWidth={1.75} color="var(--color-neutral)" />
            <span>Projects</span>
          </div>
        )}
        
        {projects.map((proj, idx) => {
          const isActive = proj.id === activeProjectId;
          const ProjectIcon = Code2;
          const displayTitle = getProjectDisplayTitle(proj);
          return (
            <div
              key={`${proj.id}-${idx}`}
              onClick={() => onSelectProject(proj.id)}
              className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
              title={collapsed ? `${displayTitle} • ${proj.framework || 'React 18'}` : displayTitle}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelectProject(proj.id); }}
              aria-label={`Select ${displayTitle}`}
              style={{
                background: isActive ? 'rgba(255, 255, 255, 0.08)' : undefined,
                color: isActive ? '#ffffff' : 'var(--text-secondary)',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'space-between',
                padding: collapsed ? '7px 0' : '5px 8px',
                transition: 'background 0.15s ease, color 0.15s ease',
                marginBottom: '1px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1, justifyContent: collapsed ? 'center' : 'flex-start' }}>
                <ProjectIcon size={16} strokeWidth={1.75} color={isActive ? '#ffffff' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
                {!collapsed && (
                  <span style={{ 
                    fontSize: '13px', 
                    whiteSpace: 'nowrap', 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis',
                    fontWeight: isActive ? 500 : 400,
                    color: isActive ? '#ffffff' : 'var(--text-primary)',
                    minWidth: 0,
                    lineHeight: '18px'
                  }}>
                    {displayTitle}
                  </span>
                )}
              </div>
              {!collapsed && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, marginLeft: 'auto' }}>
                  <span style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: '18px'
                  }}>
                    {formatRelativeTime(proj.updatedAt)}
                  </span>
                  <div 
                    className="sidebar-actions-menu-wrapper"
                    style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuProjectId(prev => prev === proj.id ? null : proj.id);
                      }}
                      title="Project actions"
                      aria-label={`Actions for ${displayTitle}`}
                      aria-expanded={activeMenuProjectId === proj.id}
                      style={{
                        background: activeMenuProjectId === proj.id ? 'rgba(255, 255, 255, 0.12)' : 'transparent',
                        border: 'none',
                        color: activeMenuProjectId === proj.id ? '#ffffff' : 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '3px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '4px',
                        minWidth: '22px',
                        minHeight: '22px',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <MoreHorizontal size={16} strokeWidth={1.75} />
                    </button>

                    {activeMenuProjectId === proj.id && (
                      <div 
                        ref={menuRef}
                        style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          width: '180px',
                          background: '#12141c',
                          border: '1px solid var(--border-medium)',
                          borderRadius: '8px',
                          boxShadow: '0 12px 28px rgba(0, 0, 0, 0.65)',
                          padding: '4px',
                          zIndex: 1000,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px'
                        }}
                      >
                        <button
                          className="deploy-menu-item"
                          onClick={(e) => handleBranchProject(e, proj.id, displayTitle)}
                          style={{ padding: '6px 8px', fontSize: '12px' }}
                        >
                          <GitBranch size={16} strokeWidth={1.75} color="var(--color-neutral)" />
                          <span>Branch Project</span>
                        </button>

                        {proj.id !== activeProjectId && (
                          <button
                            className="deploy-menu-item"
                            onClick={(e) => handleMergeProject(e, proj.id, displayTitle)}
                            style={{ padding: '6px 8px', fontSize: '12px' }}
                          >
                            <GitMerge size={16} strokeWidth={1.75} color="#38bdf8" />
                            <span>Merge into Current</span>
                          </button>
                        )}

                        <button
                          className="deploy-menu-item"
                          onClick={(e) => handleShareProject(e, proj.id)}
                          style={{ padding: '6px 8px', fontSize: '12px' }}
                        >
                          {copiedId === proj.id ? <Check size={16} strokeWidth={1.75} color="var(--color-success)" /> : <Share2 size={16} strokeWidth={1.75} color="var(--color-neutral)" />}
                          <span>{copiedId === proj.id ? 'Copied Link!' : 'Share Link'}</span>
                        </button>

                        {projects.length > 1 && (
                          <>
                            <div className="deploy-menu-divider" style={{ margin: '3px 0' }} />
                            <button
                              className="deploy-menu-item"
                              onClick={(e) => handleDeleteProject(e, proj.id)}
                              style={{ padding: '6px 8px', fontSize: '12px', color: 'var(--color-error)' }}
                            >
                              <Trash2 size={16} strokeWidth={1.75} color="var(--color-error)" />
                              <span>Delete Project</span>
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      
      {/* Bottom Footer Actions */}
      <div style={{ padding: '12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {collapsed && onToggleCollapse && (
          <button 
            className="button-ghost"
            onClick={onToggleCollapse}
            title="Expand Sidebar"
            style={{ width: '100%', justifyContent: 'center', padding: '9px 0' }}
          >
            <PanelLeftOpen size={16} strokeWidth={1.75} />
          </button>
        )}
        <button 
          className="button-ghost" 
          onClick={() => setShowSettings(true)}
          title={collapsed ? "Settings" : undefined}
          style={{ width: '100%', justifyContent: collapsed ? 'center' : 'flex-start', padding: collapsed ? '9px 0' : '8px 10px' }}
        >
          <Settings size={16} strokeWidth={1.75} />
          {!collapsed && <span>Settings</span>}
        </button>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div 
          onClick={() => setShowSettings(false)}
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
                <Settings size={16} strokeWidth={1.75} color="var(--accent-light)" />
                <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)', fontFamily: 'var(--font-brand)' }}>Studio Preferences</h3>
              </div>
              <button className="icon-btn" onClick={() => setShowSettings(false)}>
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: 'rgba(255, 255, 255, 0.025)', borderRadius: '6px', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Server size={16} strokeWidth={1.75} color="#4ade80" />
                  <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>Storage & Workspace</strong>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  Project files, sessions, and code changes are automatically saved and synchronized in real time.
                </p>
              </div>

              <div style={{ background: 'rgba(255, 255, 255, 0.025)', borderRadius: '6px', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Sparkles size={16} strokeWidth={1.75} color="var(--accent-light)" />
                  <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>AI Generation</strong>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  Build full-stack React components, modern styles, state management, and interactive UI in seconds.
                </p>
              </div>

              <div style={{ background: 'rgba(255, 255, 255, 0.025)', borderRadius: '6px', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Cpu size={16} strokeWidth={1.75} color="var(--accent-light)" />
                  <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>Live Preview Runtime</strong>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  Sub-second compilation and hot-reloading with zero local environment setup required.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
              <button className="button-primary" onClick={() => setShowSettings(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Accessible Non-Blocking Delete Confirmation Dialog */}
      <ConfirmModal
        isOpen={Boolean(projectToDelete)}
        title="Delete Project"
        message="Are you sure you want to delete this project? All files, chat history, and generated code will be permanently deleted."
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => setProjectToDelete(null)}
      />
    </div>
    </>
  );
};

export default Sidebar;
