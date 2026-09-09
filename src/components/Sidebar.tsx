import React, { useState, useEffect } from 'react';
import { Sparkles, MessageSquare, Settings, Plus, Layers, Trash2, X, Cpu, Server, PanelLeftClose, PanelLeftOpen, Code2 } from 'lucide-react';
import { Project, getProjects, createProject, deleteProject } from '../lib/project-store';
import { appEvents } from '../lib/events';

interface SidebarProps {
  activeProjectId: string;
  onSelectProject: (id: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeProjectId, onSelectProject, collapsed = false, onToggleCollapse }) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  const refreshProjects = () => {
    setProjects(getProjects());
  };

  useEffect(() => {
    refreshProjects();

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
    <div className={`sidebar-container ${collapsed ? 'collapsed' : ''}`}>
      {/* Brand Header & Toggle Button */}
      <div style={{ 
        padding: collapsed ? '0 12px' : '0 16px', 
        marginBottom: '20px', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: collapsed ? 'center' : 'space-between',
        height: '36px'
      }}>
        {!collapsed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="sidebar-brand-badge">
              <Sparkles size={16} color="white" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ 
                fontFamily: 'var(--font-brand)', 
                fontWeight: 700, 
                fontSize: '17px', 
                letterSpacing: '-0.3px',
                background: 'linear-gradient(135deg, #ffffff 40%, var(--accent-light) 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent'
              }}>
                BrainHalf
              </span>
              <span style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600 }}>
                AI Code Studio
              </span>
            </div>
          </div>
        ) : (
          <div className="sidebar-brand-badge" onClick={onToggleCollapse} style={{ cursor: 'pointer' }} title="Expand Sidebar">
            <Sparkles size={16} color="white" />
          </div>
        )}

        {onToggleCollapse && !collapsed && (
          <button 
            className="icon-btn" 
            onClick={onToggleCollapse} 
            title="Collapse Sidebar"
            style={{ color: 'var(--text-muted)' }}
          >
            <PanelLeftClose size={18} />
          </button>
        )}
      </div>

      {/* New Project Action */}
      <div style={{ padding: '0 10px', marginBottom: '16px' }}>
        <button 
          className="sidebar-new-btn" 
          onClick={handleNewProject} 
          title={collapsed ? "New Project" : undefined}
          style={{
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '10px' : '9px 12px'
          }}
        >
          <Plus size={16} />
          {!collapsed && <span>New Project</span>}
        </button>
      </div>

      {/* Navigation / Recent Projects */}
      <div style={{ flex: 1, padding: '0 10px', display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto' }}>
        {!collapsed && (
          <div style={{ 
            fontSize: '11px', 
            color: 'var(--text-muted)', 
            textTransform: 'uppercase', 
            padding: '6px 8px 4px 8px', 
            fontWeight: 600,
            letterSpacing: '0.05em',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <Layers size={12} color="var(--accent-secondary)" />
            <span>Recent Projects</span>
          </div>
        )}
        
        {projects.map((proj, idx) => {
          const isActive = proj.id === activeProjectId;
          // Assign contextual visual icon per project type or index
          const ProjectIcon = idx % 3 === 0 ? Code2 : idx % 3 === 1 ? Layers : MessageSquare;
          return (
            <div
              key={proj.id}
              onClick={() => onSelectProject(proj.id)}
              className="sidebar-nav-item"
              title={collapsed ? proj.name : undefined}
              style={{
                background: isActive ? 'rgba(168, 85, 247, 0.12)' : 'transparent',
                color: isActive ? '#ffffff' : 'var(--text-secondary)',
                borderLeft: isActive && !collapsed ? '2px solid var(--accent-secondary)' : '2px solid transparent',
                borderRadius: isActive && !collapsed ? '0 6px 6px 0' : '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'space-between',
                padding: collapsed ? '9px 0' : '7px 10px',
                transition: 'all 0.15s ease'
              } as any}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1, justifyContent: collapsed ? 'center' : 'flex-start' }}>
                <ProjectIcon size={15} color={isActive ? 'var(--accent-light)' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
                {!collapsed && (
                  <span style={{ 
                    fontSize: '13px', 
                    whiteSpace: 'nowrap', 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis',
                    fontWeight: isActive ? 500 : 400
                  }}>
                    {proj.name}
                  </span>
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
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    opacity: 0.6,
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#f87171'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          );
        })}

        {/* Subtle divider & Onboarding hint to collapse dead empty space */}
        {!collapsed && (
          <div style={{ marginTop: 'auto', paddingTop: '16px', paddingBottom: '8px' }}>
            <div style={{ height: '1px', background: 'var(--border-subtle)', marginBottom: '14px' }} />
            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--accent-light)', fontWeight: 600 }}>
                <Sparkles size={12} />
                <span>STUDIO WORKFLOW</span>
              </div>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                Each project maintains isolated SQLite chat history, WebContainer virtual node, and hot-reload state.
              </p>
            </div>
          </div>
        )}
      </div>
      
      {/* Bottom Footer Actions */}
      <div style={{ padding: '12px 10px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
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
          style={{ width: '100%', justifyContent: collapsed ? 'center' : 'flex-start', padding: collapsed ? '9px 0' : '9px 10px' }}
        >
          <Settings size={16} />
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
            background: 'rgba(0,0,0,0.7)',
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
              borderRadius: '16px',
              padding: '24px',
              maxWidth: '480px',
              width: '90%',
              boxShadow: '0 20px 50px rgba(0,0,0,0.6)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Settings size={20} color="var(--accent-secondary)" />
                <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)' }}>BrainHalf Studio Settings</h3>
              </div>
              <button className="icon-btn" onClick={() => setShowSettings(false)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Server size={16} color="#4ade80" />
                  <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>Cloudflare Edge & SQLite DO</strong>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  Active session is connected to Cloudflare Workers Durable Objects with local SQLite persistence per project.
                </p>
              </div>

              <div style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <Cpu size={16} color="var(--accent-secondary)" />
                  <strong style={{ fontSize: '14px', color: 'var(--text-primary)' }}>AI Inference Pipeline</strong>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  Primary: AWS Bedrock Runtime (Claude 3.5 Sonnet / Llama 3.3 70B)<br />
                  Fallback: Cloudflare Workers AI (Llama 3.1 8B / Qwen 2.5 Coder)
                </p>
              </div>

              <div style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '14px' }}>
                <strong style={{ fontSize: '14px', color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
                  WebContainer Virtual Engine
                </strong>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  In-browser Node.js runtime running Vite + React preview with Hot Module Replacement and live code sanitization.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
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
