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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<'chat' | 'code' | 'preview'>('chat');
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 768;
    }
    return false;
  });

  const [chatWidth, setChatWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      return Math.min(460, Math.max(380, Math.floor(window.innerWidth * 0.3)));
    }
    return 400;
  });
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const isDraggingRef = React.useRef(false);

  // Auto-collapse sidebar & update mobile view state on window resize
  React.useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (window.innerWidth < 1024 && !sidebarCollapsed) {
        setSidebarCollapsed(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [sidebarCollapsed]);

  // Listen to popstate event for browser back/forward URL navigation
  React.useEffect(() => {
    const handlePopState = () => {
      const currentId = getActiveProjectId();
      setActiveId(currentId);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleSelectProject = (id: string) => {
    if (!id) return;
    setActiveProjectId(id);
    setActiveId(id);
    setMobileSidebarOpen(false);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.classList.add('is-resizing');

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
      document.body.classList.remove('is-resizing');
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
        isMobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />
      <div className="main-content">
        <TopNav 
          activeProjectId={activeProjectId}
          onSelectProject={handleSelectProject}
          onToggleMobileSidebar={() => setMobileSidebarOpen(prev => !prev)}
          mobileTab={mobileTab}
          onSelectMobileTab={setMobileTab}
          isMobile={isMobile}
        />
        <div key={activeProjectId} className={`workspace-area ${isMobile ? 'is-mobile' : ''}`}>
          {(!isMobile || mobileTab === 'chat') && (
            <ChatPanel key={`chat-${activeProjectId}`} activeProjectId={activeProjectId} width={isMobile ? undefined : chatWidth} />
          )}
          {!isMobile && (
            <div 
              className={`panel-resize-handle ${isResizing ? 'active' : ''}`}
              onMouseDown={handleMouseDown}
              onDoubleClick={handleDoubleClickDivider}
              title="Drag to resize panels (Double-click to reset)"
            />
          )}
          {(!isMobile || mobileTab === 'code' || mobileTab === 'preview') && (
            <Workspace key={`workspace-${activeProjectId}`} activeProjectId={activeProjectId} mobileTab={isMobile ? mobileTab : undefined} />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
