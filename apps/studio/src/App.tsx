import { useEffect, useState, lazy, Suspense } from 'react';
import { TopBar, FileExplorer, CodeEditor, TerminalPanel, AgentChat } from './components';
import { apiUrl } from '@lib/api';
import { useStudioInit } from '@lib/use-studio-init';

const Preview = lazy(() => import("./components/studio/Preview").then((mod) => ({ default: mod.MemoizedPreview })));

export default function App() {
  const [ready, setReady] = useState(false);
  const [viewMode, setViewMode] = useState<"Preview" | "Code">("Preview");

  useStudioInit();

  useEffect(() => {
    const init = async () => {
      try {
        await fetch(apiUrl('/api/auth/get-session'), { credentials: 'include' });
      } catch {
        /* studio works without auth in local dev */
      } finally {
        setReady(true);
      }
    };
    init();
  }, []);

  if (!ready) {
    return (
      <div className="studio-boot">
        <span className="studio-boot-dot" />
        <span>loading studio…</span>
      </div>
    );
  }

  const isCode = viewMode === "Code";
  const isPreview = viewMode === "Preview";

  return (
    <div className="studio-app">
      <TopBar viewMode={viewMode} setViewMode={setViewMode} />

      <div className="studio-workspace">
        <aside className="studio-panel-agent">
          <AgentChat />
        </aside>

        {/* File tree — only visible in Code view */}
        <aside
          className="studio-panel-files"
          style={{ display: isCode ? undefined : "none" }}
        >
          <FileExplorer />
        </aside>

        <main className="studio-panel-main">
          {/* Code editor + terminal — hidden in Preview view but stays mounted */}
          <div
            className="studio-code-stack"
            style={{ display: isCode ? "flex" : "none", flex: 1, minHeight: 0 }}
          >
            <div className="studio-code-editor">
              <CodeEditor />
            </div>
            <div className="studio-code-terminal">
              <TerminalPanel />
            </div>
          </div>

          {/* Main preview — hidden in Code view but stays mounted so the iframe
              and WebContainer state survive view switches without reinstalling. */}
          <div
            className="studio-preview-frame"
            style={{ display: isPreview ? "flex" : "none", flex: 1, minHeight: 0 }}
          >
            <div className="studio-preview-inner">
              <Suspense fallback={<div className="studio-preview-loading">starting preview…</div>}>
                <Preview compact={false} />
              </Suspense>
            </div>
          </div>
        </main>

        {/* Side preview in Code view — always mounted, toggled with CSS only */}
        <aside
          className="studio-panel-preview-side"
          style={{ display: isCode ? undefined : "none" }}
        >
          <Suspense fallback={<div className="studio-preview-loading">preview…</div>}>
            <Preview compact />
          </Suspense>
        </aside>
      </div>
    </div>
  );
}
