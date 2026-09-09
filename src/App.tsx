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

  const handleSelectProject = (id: string) => {
    setActiveProjectId(id);
    setActiveId(id);
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
          <ChatPanel activeProjectId={activeProjectId} />
          <Workspace activeProjectId={activeProjectId} />
        </div>
      </div>
    </div>
  );
}

export default App;
