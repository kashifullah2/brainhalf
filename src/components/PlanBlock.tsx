import React from 'react';
import { Network, Loader2 } from 'lucide-react';

interface PlanBlockProps {
  content: string;
  isStreaming: boolean;
}

const PlanBlock: React.FC<PlanBlockProps> = ({ content, isStreaming }) => {
  return (
    <div style={{
      background: 'rgba(59, 130, 246, 0.1)',
      border: '1px solid rgba(59, 130, 246, 0.2)',
      borderRadius: '8px',
      padding: '12px 16px',
      margin: '8px 0',
      fontSize: '14px',
      color: 'var(--text-primary)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Network size={16} color="#3b82f6" />
        <span style={{ color: '#3b82f6', fontWeight: 600 }}>Planner Agent Strategy</span>
        {isStreaming && (
          <div style={{ marginLeft: 'auto' }}>
            <Loader2 size={14} className="lucide-spin" style={{ color: '#3b82f6' }} />
          </div>
        )}
      </div>
      <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
        {content}
      </div>
    </div>
  );
};

export default PlanBlock;
