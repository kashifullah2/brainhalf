import React from 'react';

interface MacOSTrafficLightsProps {
  onClose?: () => void;
  onMinimize?: () => void;
  onZoom?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

const MacOSTrafficLights: React.FC<MacOSTrafficLightsProps> = ({
  onClose,
  onMinimize,
  onZoom,
  style,
  className = ''
}) => {
  const handleZoom = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onZoom) {
      onZoom();
      return;
    }
    // Default native behavior: toggle fullscreen
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleMinimize = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onMinimize) {
      onMinimize();
    }
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClose) {
      onClose();
    }
  };

  return (
    <div 
      className={`macos-traffic-lights ${className}`} 
      style={style}
      role="group"
      aria-label="macOS Window Controls"
    >
      <button 
        type="button"
        className="traffic-dot close" 
        onClick={handleClose}
        title="Close / Reset Workspace"
        aria-label="Close"
      >
        <span className="dot-glyph">✕</span>
      </button>

      <button 
        type="button"
        className="traffic-dot minimize" 
        onClick={handleMinimize}
        title="Minimize / Toggle Sidebar"
        aria-label="Minimize"
      >
        <span className="dot-glyph">−</span>
      </button>

      <button 
        type="button"
        className="traffic-dot zoom" 
        onClick={handleZoom}
        title="Toggle Fullscreen"
        aria-label="Zoom / Fullscreen"
      >
        <span className="dot-glyph">+</span>
      </button>
    </div>
  );
};

export default MacOSTrafficLights;
