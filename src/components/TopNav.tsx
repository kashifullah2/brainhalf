import React, { useState, useEffect, useRef } from 'react';
import { Play, Download, Share2, Sparkles, Check, Edit2, X, Terminal, ExternalLink, ChevronDown, MoreHorizontal, Cloud, Settings, RotateCcw, Info } from 'lucide-react';
import { appEvents } from '../lib/events';
import { getProjects, getActiveProjectId, updateProjectName } from '../lib/project-store';

interface TopNavProps {
  activeProjectId: string;
  onProjectRenamed?: (id: string, name: string) => void;
}

const TopNav: React.FC<TopNavProps> = ({ activeProjectId, onProjectRenamed }) => {
  const [projectName, setProjectName] = useState('Untitled Project');
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState('');
  const [copied, setCopied] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showDeployDropdown, setShowDeployDropdown] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const deployDropdownRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const projects = getProjects();
    const curr = projects.find(p => p.id === activeProjectId);
    if (curr) {
      setProjectName(curr.name);
      setEditedName(curr.name);
    }
  }, [activeProjectId]);

  // Click outside to close dropdowns
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (deployDropdownRef.current && !deployDropdownRef.current.contains(e.target as Node)) {
        setShowDeployDropdown(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setShowMoreMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSaveName = () => {
    const trimmed = editedName.trim() || 'Untitled Project';
    setProjectName(trimmed);
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
    } catch (e) {
      prompt('Copy project URL:', shareUrl);
    }
  };

  const handleExport = () => {
    appEvents.emit('request-export', { projectName });
  };

  const handleResetWorkspace = () => {
    if (confirm('Reset workspace to default React template? Any unsaved edits will be cleared.')) {
      appEvents.emit('clear-workspace');
      setShowMoreMenu(false);
    }
  };

  return (
    <div className="top-nav">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ 
            width: '7px', 
            height: '7px', 
            borderRadius: '50%', 
            background: 'var(--color-success)', 
            boxShadow: '0 0 6px var(--color-success)' 
          }} />

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
              >
                <Check size={13} color="var(--color-success)" />
              </button>
              <button 
                onClick={() => setIsEditing(false)}
                className="icon-btn" 
                style={{ padding: '3px' }}
                title="Cancel"
              >
                <X size={13} color="var(--color-error)" />
              </button>
            </div>
          ) : (
            <div 
              onClick={() => { setIsEditing(true); setEditedName(projectName); }}
              title="Click to rename project"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
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
        </div>
        <span style={{
          fontSize: '9.5px',
          padding: '2px 7px',
          borderRadius: '4px',
          background: 'var(--color-neutral-bg)',
          border: '1px solid var(--color-neutral-border)',
          color: 'var(--color-neutral)',
          fontWeight: 600,
          letterSpacing: '0.05em'
        }}>
          DRAFT
        </span>
      </div>
      
      {/* Clear Action Hierarchy (Item 13: Share  ⋯  [Export]  [Deploy ↗ ▾]) */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button 
          className="button-ghost" 
          onClick={handleShare} 
          title="Share project link"
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
          style={{ padding: '6px 12px', fontSize: '12px' }}
        >
          <Download size={13} /> 
          <span>Export</span>
        </button>

        {/* Primary CTA: Deploy ↗ with Dropdown Menu (Item 13) */}
        <div className="deploy-menu-container" ref={deployDropdownRef}>
          <div className="deploy-split-btn">
            <button 
              className="deploy-main-action"
              onClick={() => setShowDeployModal(true)}
              title="Deploy project to Cloudflare"
            >
              <Play size={12} fill="white" /> 
              <span>Deploy ↗</span>
            </button>
            <button 
              className="deploy-toggle-action"
              onClick={() => setShowDeployDropdown(prev => !prev)}
              title="Open deployment targets"
            >
              <ChevronDown size={12} />
            </button>
          </div>

          {showDeployDropdown && (
            <div className="deploy-dropdown-menu">
              <button 
                className="deploy-menu-item"
                onClick={() => {
                  setShowDeployModal(true);
                  setShowDeployDropdown(false);
                }}
              >
                <Cloud size={14} color="var(--color-info)" />
                <div>
                  <div style={{ fontWeight: 600 }}>Cloudflare Pages</div>
                  <div className="deploy-menu-item-subtext">Instant edge deployment</div>
                </div>
              </button>

              <button 
                className="deploy-menu-item"
                onClick={() => {
                  handleExport();
                  setShowDeployDropdown(false);
                }}
              >
                <Download size={14} color="var(--color-success)" />
                <div>
                  <div style={{ fontWeight: 600 }}>Download ZIP</div>
                  <div className="deploy-menu-item-subtext">Offline production build</div>
                </div>
              </button>

              <div className="deploy-menu-divider" />

              <button 
                className="deploy-menu-item"
                onClick={() => {
                  setShowSettingsModal(true);
                  setShowDeployDropdown(false);
                }}
              >
                <Settings size={14} color="var(--color-neutral)" />
                <div>
                  <div style={{ fontWeight: 600 }}>Deployment Settings</div>
                  <div className="deploy-menu-item-subtext">Configuration & docs</div>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Cloudflare Deploy Modal */}
      {showDeployModal && (
        <div 
          onClick={() => setShowDeployModal(false)}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Cloud size={20} color="var(--color-info)" />
                <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)' }}>Deploy {projectName}</h3>
              </div>
              <button className="icon-btn" onClick={() => setShowDeployModal(false)}>
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '16px' }}>
              You can deploy this project to Cloudflare Pages or Workers with zero configuration:
            </p>

            <div style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '14px', marginBottom: '16px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#93c5fd' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: '6px' }}># 1. Export your project ZIP & extract it</div>
              <div style={{ color: 'var(--text-primary)', marginBottom: '10px' }}>npm install</div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '6px' }}># 2. Deploy instantly to Cloudflare</div>
              <div style={{ color: 'var(--color-success)' }}>npx wrangler pages deploy dist</div>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button 
                className="button-ghost"
                onClick={() => {
                  handleExport();
                  setShowDeployModal(false);
                }}
              >
                <Download size={14} /> Download ZIP First
              </button>
              <button 
                className="button-primary"
                onClick={() => {
                  window.open('https://dash.cloudflare.com', '_blank');
                  setShowDeployModal(false);
                }}
              >
                Open Cloudflare Dashboard <ExternalLink size={13} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deployment Settings Modal */}
      {showSettingsModal && (
        <div 
          onClick={() => setShowSettingsModal(false)}
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
              maxWidth: '460px',
              width: '90%',
              boxShadow: '0 20px 50px rgba(0,0,0,0.6)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Settings size={18} color="var(--color-info)" />
                <h3 style={{ margin: 0, fontSize: '17px', color: 'var(--text-primary)' }}>Deployment Settings</h3>
              </div>
              <button className="icon-btn" onClick={() => setShowSettingsModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              <div>
                <label style={{ display: 'block', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '4px' }}>Build Framework</label>
                <div style={{ padding: '8px 12px', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: '#e2e8f0', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                  Vite + React 18 (Client SPA)
                </div>
              </div>

              <div>
                <label style={{ display: 'block', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '4px' }}>Build Output Directory</label>
                <div style={{ padding: '8px 12px', background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: '#e2e8f0', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                  dist/
                </div>
              </div>

              <div>
                <label style={{ display: 'block', color: 'var(--text-primary)', fontWeight: 600, marginBottom: '4px' }}>Deploy Targets</label>
                <p style={{ margin: 0, lineHeight: 1.5 }}>
                  Compatible with Cloudflare Pages, Vercel, Netlify, and GitHub Pages. Export as ZIP to run locally with <code style={{ color: 'var(--color-success)' }}>npm run build</code>.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
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
    </div>
  );
};

export default TopNav;
