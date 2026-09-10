import React, { useState, useEffect } from 'react';
import { Sparkles, MessageSquare, Settings, Plus, Layers, Trash2, X, Cpu, Server, PanelLeftClose, PanelLeftOpen, Code2 } from 'lucide-react';
import { Project, getProjects, createProject, deleteProject, formatRelativeTime } from '../lib/project-store';
import { appEvents } from '../lib/events';

interface SidebarProps {
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeProjectId, onSelectProject, collapsed = false, onToggleCollapse }) => {
  const [projects, setProjects] = useState<Project[]>(() => getProjects());
  const [showSettings, setShowSettings] = useState(false);

  const refreshProjects = () => {
    setProjects(getProjects());
  };

  useEffect(() => {
    const unsubRenamed = appEvents.on('project-renamed', () => {
      refreshProjects();
    });

    return () => {
      unsubRenamed();
    };
  }, []);

  const handleNewProject = () => {
    const newProj = createProject(`Project ${projects.length + 1}`);
    refreshProjects();
    onSelectProject(newProj.id);
  };

  const handleDeleteProject = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Delete this project?')) {
      const remaining = deleteProject(id);
      setProjects(remaining);
      if (activeProjectId === id) {
        onSelectProject(remaining[0]?.id || 'default');
      }
    }
  };

  return (
    <div className={`sidebar-container ${collapsed ? 'collapsed' : ''}`} role="navigation" aria-label="Projects Sidebar">
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
            <div className="sidebar-brand-badge">
              <Sparkles size={14} color="#ffffff" />
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
          <div className="sidebar-brand-badge" onClick={onToggleCollapse} style={{ cursor: 'pointer' }} title="Expand Sidebar" aria-label="Expand Sidebar">
            <Sparkles size={14} color="#ffffff" />
          </div>
        )}

        {onToggleCollapse && !collapsed && (
          <button 
            className="icon-btn" 
            onClick={onToggleCollapse} 
            title="Collapse Sidebar"
            aria-label="Collapse Sidebar"
            style={{ color: 'var(--text-muted)' }}
          >
            <PanelLeftClose size={15} />
          </button>
        )}
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
            border: '1px solid rgba(255, 255, 255, 0.15)',
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
          <Plus size={14} strokeWidth={2.5} />
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
            <Layers size={12} color="var(--color-neutral)" />
            <span>Projects</span>
          </div>
        )}
        
        {projects.map((proj, idx) => {
          const isActive = proj.id === activeProjectId;
          const ProjectIcon = idx % 3 === 0 ? Code2 : idx % 3 === 1 ? Layers : MessageSquare;
          return (
            <div
              key={proj.id}
              onClick={() => onSelectProject(proj.id)}
              className="sidebar-nav-item"
              title={collapsed ? `${proj.name} • ${proj.framework || 'React 18'}` : undefined}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelectProject(proj.id); }}
              aria-label={`Select ${proj.name}`}
              style={{
                background: isActive ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                color: isActive ? '#ffffff' : 'var(--text-secondary)',
                borderLeft: isActive && !collapsed ? '2px solid var(--color-info)' : '2px solid transparent',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'space-between',
                padding: collapsed ? '9px 0' : '8px 10px',
                transition: 'all 0.15s ease',
                marginBottom: '2px'
              } as any}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0, flex: 1, justifyContent: collapsed ? 'center' : 'flex-start' }}>
                <ProjectIcon size={16} color={isActive ? '#ffffff' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
                {!collapsed && (
                  <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
                    <span style={{ 
                      fontSize: '13px', 
                      whiteSpace: 'nowrap', 
                      overflow: 'hidden', 
                      textOverflow: 'ellipsis',
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? '#ffffff' : 'var(--text-primary)'
                    }}>
                      {proj.name}
                    </span>
                    <span style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      marginTop: '2px'
                    }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {formatRelativeTime(proj.updatedAt)}
                      </span>
                    </span>
                  </div>
                )}
              </div>
              {!collapsed && projects.length > 1 && (
                <button
                  onClick={(e) => handleDeleteProject(e, proj.id)}
                  title="Delete project"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '3px',
                    display: 'flex',
                    alignItems: 'center',
                    opacity: 0.5,
                    transition: 'all 0.2s',
                    borderRadius: '4px'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#f87171'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          );
        })}

        {/* Workspace Quick File Explorer */}
        {!collapsed && (
          <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
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
              <Code2 size={12} color="var(--color-neutral)" />
              <span>Files</span>
            </div>
            
            {/* Quick list of primary generated files */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {[
                { name: 'App.jsx', path: '/src/App.jsx', icon: Code2 },
                { name: 'styles.css', path: '/src/styles.css', icon: Layers },
                { name: 'main.jsx', path: '/src/main.jsx', icon: Code2 },
                { name: 'package.json', path: '/package.json', icon: Server }
              ].map(f => (
                <div
                  key={f.path}
                  onClick={() => appEvents.emit('open-file', { path: f.path })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 8px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  className="hover-bright"
                  title={`Open ${f.path}`}
                >
                  <f.icon size={13} color="var(--color-neutral)" />
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{f.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
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
            <PanelLeftOpen size={16} />
          </button>
        )}
        <button 
          className="button-ghost" 
          onClick={() => setShowSettings(true)}
          title={collapsed ? "Settings" : undefined}
          style={{ width: '100%', justifyContent: collapsed ? 'center' : 'flex-start', padding: collapsed ? '9px 0' : '8px 10px' }}
        >
          <Settings size={15} />
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
                <Settings size={20} color="var(--color-info)" />
                <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)', fontFamily: 'var(--font-brand)' }}>BrainHalf Studio Settings</h3>
              </div>
              <button className="icon-btn" onClick={() => setShowSettings(false)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: 'rgba(255, 255, 255, 0.025)', borderRadius: '6px', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Server size={16} color="#4ade80" />
                  <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>Cloudflare Edge & SQLite DO</strong>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  Active session is connected to Cloudflare Workers Durable Objects with local SQLite persistence per project.
                </p>
              </div>

              <div style={{ background: 'rgba(255, 255, 255, 0.025)', borderRadius: '6px', padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Cpu size={16} color="var(--color-ai)" />
                  <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)' }}>AI Inference Pipeline</strong>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  Primary: AWS Bedrock Runtime (Claude 3.5 Sonnet / Llama 3.3 70B)<br />
                  Fallback: Cloudflare Workers AI (Llama 3.1 8B / Qwen 2.5 Coder)
                </p>
              </div>

              <div style={{ background: 'rgba(255, 255, 255, 0.025)', borderRadius: '6px', padding: '16px' }}>
                <strong style={{ fontSize: '13.5px', color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                  Cloudflare Edge Transpilation Engine (Sucrase)
                </strong>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  Sub-millisecond on-the-fly JSX/TSX edge transpilation powered by Sucrase inside Cloudflare Durable Objects with zero cold-start latency.
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
    </div>
  );
};

export default Sidebar;
