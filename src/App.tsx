import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import TopNav from './components/TopNav';
import ChatPanel from './components/ChatPanel';
import Workspace from './components/Workspace';
import { getActiveProjectId, setActiveProjectId } from './lib/project-store';
import './index.css';

function App() {
  const [activeProjectId, setActiveId] = useState<string>(getActiveProjectId());
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 1024;
    }
    return false;
  });
  const [chatWidth, setChatWidth] = useState<number>(440);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const isDraggingRef = React.useRef(false);

  // Auto-collapse sidebar on smaller screens
  React.useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024 && !sidebarCollapsed) {
        setSidebarCollapsed(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [sidebarCollapsed]);

  const handleSelectProject = (id: string) => {
    setActiveProjectId(id);
    setActiveId(id);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const sidebarOffset = sidebarCollapsed ? 56 : 240;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const calculatedWidth = moveEvent.clientX - sidebarOffset;
      const clampedWidth = Math.min(Math.max(calculatedWidth, 360), Math.min(window.innerWidth - 500, 720));
      setChatWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleDoubleClickDivider = () => {
    setChatWidth(440);
  };

  return (
    <div className="app-container">
      <Sidebar 
        activeProjectId={activeProjectId} 
        onSelectProject={handleSelectProject} 
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div className="main-content">
        <TopNav activeProjectId={activeProjectId} />
        <div className="workspace-area">
          <ChatPanel activeProjectId={activeProjectId} width={chatWidth} />
          <div 
            className={`panel-resize-handle ${isResizing ? 'active' : ''}`}
            onMouseDown={handleMouseDown}
            onDoubleClick={handleDoubleClickDivider}
            title="Drag to resize panels (Double-click to reset)"
          />
          <Workspace activeProjectId={activeProjectId} />
        </div>
      </div>
    </div>
  );
}

export default App;
