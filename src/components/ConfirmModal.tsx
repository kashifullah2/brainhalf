import React, { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isDestructive = true,
  onConfirm,
  onCancel,
}) => {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Focus cancel button by default for safety on destructive actions
    const timer = setTimeout(() => {
      cancelBtnRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 0.15s ease-out',
      }}
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div
        style={{
          background: 'var(--bg-panel, #121316)',
          border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
          borderRadius: '10px',
          width: '100%',
          maxWidth: '420px',
          padding: '22px',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: isDestructive ? 'rgba(239, 68, 68, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <AlertTriangle size={16} strokeWidth={1.75} color={isDestructive ? '#ef4444' : '#3b82f6'} />
            </div>
            <h3
              id="confirm-modal-title"
              style={{
                margin: 0,
                fontSize: '15px',
                fontWeight: 600,
                color: 'var(--text-primary, #ffffff)',
                letterSpacing: '-0.2px',
              }}
            >
              {title}
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="icon-btn"
            title="Close"
            aria-label="Close dialog"
            style={{ padding: '4px', color: 'var(--text-muted, #9ca3af)' }}
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <p
          style={{
            margin: 0,
            fontSize: '13px',
            color: 'var(--text-secondary, #9ca3af)',
            lineHeight: 1.5,
          }}
        >
          {message}
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
          <button
            ref={cancelBtnRef}
            onClick={onCancel}
            style={{
              background: 'transparent',
              border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))',
              borderRadius: '6px',
              color: 'var(--text-primary, #ffffff)',
              fontSize: '13px',
              fontWeight: 500,
              padding: '7px 14px',
              cursor: 'pointer',
              transition: 'background 0.15s ease',
            }}
            className="hover-subtle"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: isDestructive ? '#dc2626' : 'var(--accent-primary, #3b82f6)',
              border: 'none',
              borderRadius: '6px',
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 600,
              padding: '7px 16px',
              cursor: 'pointer',
              boxShadow: isDestructive ? '0 2px 8px rgba(220, 38, 38, 0.4)' : '0 2px 8px rgba(59, 130, 246, 0.4)',
              transition: 'opacity 0.15s ease',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
