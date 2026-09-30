import React from 'react';
import { Network, Loader2 } from 'lucide-react';

interface PlanBlockProps {
  content: string;
  isStreaming: boolean;
}

const PlanBlock: React.FC<PlanBlockProps> = ({ content, isStreaming }) => {
  return (
    <div style={{
      background: 'rgba(59, 130, 246, 0.05)',
      border: 'none',
      borderLeft: '2px solid var(--color-info)',
      borderRadius: '4px',
      padding: '12px 16px',
      margin: '8px 0',
      fontSize: '13.5px',
      color: 'var(--text-primary)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Network size={16} color="var(--color-info)" />
        <span style={{ color: 'var(--color-info)', fontWeight: 600 }}>Builder’s plan</span>
        {isStreaming && (
          <div style={{ marginLeft: 'auto' }}>
            <Loader2 size={14} className="lucide-spin" style={{ color: 'var(--color-info)' }} />
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
