import React, { useState, useEffect } from 'react';
import { Play, Download, Share2, Sparkles, Check, Edit2, X, Terminal, ExternalLink } from 'lucide-react';
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

  useEffect(() => {
    const projects = getProjects();
    const curr = projects.find(p => p.id === activeProjectId);
    if (curr) {
      setProjectName(curr.name);
      setEditedName(curr.name);
    }
  }, [activeProjectId]);

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

  return (
    <div className="top-nav">
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ 
            width: '8px', 
            height: '8px', 
            borderRadius: '50%', 
            background: 'var(--accent-secondary)', 
            boxShadow: '0 0 8px var(--accent-secondary)' 
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
                  border: '1px solid var(--accent-secondary)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  fontWeight: 600,
                  padding: '4px 8px',
                  outline: 'none',
                  fontFamily: 'var(--font-brand)',
                }}
              />
              <button 
                onClick={handleSaveName}
                className="icon-btn" 
                style={{ padding: '4px' }}
                title="Save name"
              >
                <Check size={14} color="#4ade80" />
              </button>
              <button 
                onClick={() => setIsEditing(false)}
                className="icon-btn" 
                style={{ padding: '4px' }}
                title="Cancel"
              >
                <X size={14} color="#f87171" />
              </button>
            </div>
          ) : (
            <div 
              onClick={() => { setIsEditing(true); setEditedName(projectName); }}
              title="Click to rename project"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
            >
              <h2 style={{ 
                fontSize: '14px', 
                fontWeight: 600, 
                margin: 0, 
                fontFamily: 'var(--font-brand)',
                color: 'var(--text-primary)',
                letterSpacing: '-0.2px'
              }}>
                {projectName}
              </h2>
              <Edit2 size={12} style={{ opacity: 0.4 }} />
            </div>
          )}
        </div>
        <span className="brand-draft-badge">
          DRAFT
        </span>
      </div>
      
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <button className="button-ghost" onClick={handleShare} title="Share project link">
          {copied ? <Check size={14} color="#4ade80" /> : <Share2 size={14} />}
          <span>{copied ? 'Copied Link!' : 'Share'}</span>
        </button>

        <button className="button-ghost" onClick={handleExport} title="Download complete project as a ZIP">
          <Download size={14} /> 
          <span>Export ZIP</span>
        </button>

        <button className="button-primary" onClick={() => setShowDeployModal(true)}>
          <Play size={14} fill="white" /> 
          <span>Deploy to Cloudflare</span>
        </button>
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
                <Sparkles size={20} color="var(--accent-secondary)" />
                <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)' }}>Deploy {projectName}</h3>
              </div>
              <button className="icon-btn" onClick={() => setShowDeployModal(false)}>
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '16px' }}>
              You can deploy this project to Cloudflare Pages or Workers with zero configuration:
            </p>

            <div style={{ background: 'var(--bg-canvas)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '14px', marginBottom: '16px', fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#c084fc' }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: '6px' }}># 1. Export your project ZIP & extract it</div>
              <div style={{ color: 'var(--text-primary)', marginBottom: '10px' }}>npm install</div>
              <div style={{ color: 'var(--text-muted)', marginBottom: '6px' }}># 2. Deploy instantly to Cloudflare</div>
              <div style={{ color: '#4ade80' }}>npx wrangler pages deploy dist</div>
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
    </div>
  );
};

export default TopNav;
