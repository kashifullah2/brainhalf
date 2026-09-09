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

      {/* Primary New Project Action */}
      <div style={{ padding: '0 12px', marginBottom: '14px' }}>
        <button 
          onClick={handleNewProject} 
          title={collapsed ? "New Project" : undefined}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'center',
            gap: '8px',
            background: 'linear-gradient(135deg, #6366f1, #a855f7)',
            color: '#ffffff',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: '8px',
            padding: collapsed ? '10px' : '9px 14px',
            fontWeight: 600,
            fontSize: '13px',
            cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(168, 85, 247, 0.3)',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(168, 85, 247, 0.45)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 10px rgba(168, 85, 247, 0.3)';
          }}
        >
          <Plus size={16} strokeWidth={2.5} />
          {!collapsed && <span>New project</span>}
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
            letterSpacing: '0.06em',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <Layers size={12} color="var(--accent-secondary)" />
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
              title={collapsed ? proj.name : undefined}
              style={{
                background: isActive ? 'rgba(168, 85, 247, 0.12)' : 'transparent',
                color: isActive ? '#ffffff' : 'var(--text-secondary)',
                borderLeft: isActive && !collapsed ? '2px solid var(--accent-secondary)' : '2px solid transparent',
                borderRadius: isActive && !collapsed ? '0 8px 8px 0' : '8px',
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
                <ProjectIcon size={16} color={isActive ? 'var(--accent-light)' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
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
                      fontSize: '10px',
                      color: isActive ? '#c084fc' : 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      marginTop: '1px'
                    }}>
                      <span style={{
                        width: '5px',
                        height: '5px',
                        borderRadius: '50%',
                        background: isActive ? '#10b981' : '#6b7280',
                        boxShadow: isActive ? '0 0 6px rgba(16, 185, 129, 0.8)' : 'none'
                      }} />
                      {isActive ? 'React App • Active' : 'React App • Saved'}
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

        {/* Workspace Quick File Explorer to occupy empty middle sidebar space */}
        {!collapsed && (
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ 
              fontSize: '11px', 
              color: 'var(--text-muted)', 
              textTransform: 'uppercase', 
              padding: '6px 8px 4px 8px', 
              fontWeight: 600,
              letterSpacing: '0.06em',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Code2 size={12} color="var(--accent-secondary)" />
                <span>Workspace Files</span>
              </div>
              <span style={{ fontSize: '10px', color: '#10b981', fontWeight: 500 }}>Vite HMR</span>
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
                    padding: '5px 8px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  className="hover-bright"
                  title={`Open ${f.path}`}
                >
                  <f.icon size={13} color="var(--accent-light)" />
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{f.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Clean System Status Indicator (Replacing disconnected Studio Workflow card) */}
        {!collapsed && (
          <div style={{ marginTop: 'auto', paddingTop: '16px', paddingBottom: '8px' }}>
            <div style={{ height: '1px', background: 'var(--border-subtle)', marginBottom: '12px' }} />
            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Runtime Engine</span>
                <span style={{ fontSize: '10px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#10b981' }} /> Online
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                <Cpu size={12} color="var(--accent-secondary)" />
                <span>WebContainer Node 18</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                <Server size={12} color="var(--accent-secondary)" />
                <span>SQLite Multi-Turn DB</span>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Bottom Footer Actions */}
      <div style={{ padding: '10px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
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
          {!collapsed && <span>Settings & Keys</span>}
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
