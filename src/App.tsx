import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import TopNav from './components/TopNav';
import ChatPanel from './components/ChatPanel';
import Workspace from './components/Workspace';
import { getActiveProjectId, setActiveProjectId } from './lib/project-store';
import './index.css';

function App() {
  const [activeProjectId, setActiveId] = useState<string>(getActiveProjectId());
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [chatWidth, setChatWidth] = useState<number>(440);
  const isDraggingRef = React.useRef(false);

  const handleSelectProject = (id: string) => {
    setActiveProjectId(id);
    setActiveId(id);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const newWidth = Math.min(Math.max(moveEvent.clientX - (sidebarCollapsed ? 64 : 250), 340), 750);
      setChatWidth(newWidth);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
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
            className="panel-resize-handle"
            onMouseDown={handleMouseDown}
            title="Drag to resize panels"
          />
          <Workspace activeProjectId={activeProjectId} />
        </div>
      </div>
    </div>
  );
}

export default App;
