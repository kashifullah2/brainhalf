// Studio client component

/**
 * CodeEditor — Memoized Monaco editor component.
 *
 * Uses fine-grained Zustand selectors so it ONLY re-renders when
 * file content / open tabs / active file actually change.
 * It is completely immune to agentMessages / isGenerating updates.
 */

import { useStudioStore } from "@stores/studio-store";
import { webContainerManager } from "@lib/webcontainer";
import { saveDirtyFiles } from "@lib/persistence";
import { syncPreviewAfterFileWrite } from "@lib/preview-sync";
import { X } from "lucide-react";
import { memo, useCallback, useMemo, lazy, Suspense, CSSProperties, useEffect, useRef } from "react";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

export const CodeEditor = memo(function CodeEditor() {
  // ── Fine-grained selectors ──
  const projectFiles = useStudioStore(state => state.projectFiles);
  const openFiles = useStudioStore(state => state.openFiles);
  const activeFileId = useStudioStore(state => state.activeFileId);
  const setActiveFile = useStudioStore(state => state.setActiveFile);
  const closeFile = useStudioStore(state => state.closeFile);
  const updateFileContent = useStudioStore(state => state.updateFileContent);
  const editorRef = useRef<any>(null);

  // ── Memoized derived state ──
  const activeFile = useMemo(
    () => projectFiles.find((f) => f.id === activeFileId),
    [projectFiles, activeFileId]
  );

  const openFileNodes = useMemo(
    () => openFiles.map((id) => projectFiles.find((f) => f.id === id)).filter(Boolean) as typeof projectFiles,
    [openFiles, projectFiles]
  );

  // ── Utility functions ──
  const getLanguage = useCallback((name: string) => {
    if (name.endsWith(".js") || name.endsWith(".ts") || name.endsWith(".jsx") || name.endsWith(".tsx")) return "javascript";
    if (name.endsWith(".html")) return "html";
    if (name.endsWith(".css")) return "css";
    if (name.endsWith(".json")) return "json";
    return "plaintext";
  }, []);

  // ── Safe file path builder ──
  const getFilePath = useCallback((file: typeof projectFiles[0]) => {
    // If we have a full path, use it. Otherwise, assume root and prefix if needed.
    if (file.path) return file.path;
    // You can extend this to build paths from parentId relationships
    return `/${file.name}`;
  }, []);

  // ── Robust Save Handler ──
  const handleSave = useCallback(async () => {
    // Fetch the absolute latest state to avoid closure race conditions
    const state = useStudioStore.getState();
    const fileToSave = state.projectFiles.find(f => f.id === activeFileId);

    if (!fileToSave) return;
    if (fileToSave.content === undefined) {
      state.setSaveStatus("Unsaved changes");
      return;
    }

    const filePath = getFilePath(fileToSave);
    try {
      await webContainerManager.writeFiles({ [filePath]: fileToSave.content });
      await syncPreviewAfterFileWrite(filePath, fileToSave.content);
      // Persist to the backend; saveDirtyFiles clears dirty flags + save status.
      await saveDirtyFiles();
      if (useStudioStore.getState().projectId == null) {
        // No backend project (e.g. anonymous) — at least reflect the local write.
        state.setSaveStatus("Saved");
      }
    } catch (error) {
      console.error("Save failed:", error);
      state.setSaveStatus("Unsaved changes");
    }
  }, [activeFileId, getFilePath]);

  // ── Monaco Editor Handlers ──
  const handleEditorChange = useCallback(
    (val: string | undefined) => {
      if (val !== undefined && activeFileId) updateFileContent(activeFileId, val);
    },
    [activeFileId, updateFileContent]
  );

  const handleEditorDidMount = useCallback((editor: any) => {
    editorRef.current = editor;
    editor.focus();
  }, []);

  // ── Stable Monaco Options ──
  const editorOptions = useMemo(() => ({
    minimap: { enabled: true, scale: 0.6 },
    fontSize: 13,
    fontFamily: '"Geist Mono", ui-monospace, monospace',
    lineHeight: 1.65,
    padding: { top: 16 },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    cursorBlinking: "smooth" as const,
    cursorSmoothCaretAnimation: "on" as const,
    renderLineHighlight: "all" as const,
    formatOnType: true,
    formatOnPaste: true,
    automaticLayout: true,
  }), []);

  // ── Keyboard Save Binding ──
  useEffect(() => {
    const handleGlobalSave = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleGlobalSave);
    return () => window.removeEventListener("keydown", handleGlobalSave);
  }, [handleSave]);

  // ── Simple Tab Style (no useCallback needed) ──
  const getTabStyle = (active: boolean): CSSProperties => ({
    display: "flex", alignItems: "center", gap: 8, padding: "0 14px", height: 36,
    borderRight: "1px solid var(--panel-border)", cursor: "pointer", minWidth: 100, maxWidth: 160,
    background: active ? "var(--panel-center)" : "var(--bg-2)", color: active ? "var(--text)" : "var(--text-2)",
    borderTop: active ? "2px solid var(--accent)" : "2px solid transparent",
    fontSize: 12, fontFamily: "monospace", flexShrink: 0,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "var(--panel-center)" }}>
      {/* Tabs */}
      <div style={{ display: "flex", background: "var(--bg-2)", overflowX: "auto", flexShrink: 0, borderBottom: "1px solid var(--panel-border)" }}>
        {openFileNodes.map((file) => (
          <div key={file.id} style={getTabStyle(activeFileId === file.id)} onClick={() => setActiveFile(file.id)}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{file.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeFile(file.id); }}
              style={{ background: "none", border: "none", color: "#555", cursor: "pointer", display: "flex", alignItems: "center", padding: 2, borderRadius: 3, flexShrink: 0 }}
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Editor */}
      <div style={{ flex: 1, position: "relative" }}>
        {activeFile ? (
          <Suspense fallback={<div style={{ width: "100%", height: "100%", background: "var(--bg-2)" }} />}>
            <MonacoEditor
              height="100%"
              language={getLanguage(activeFile.name)}
              theme="vs-dark"
              value={activeFile.content || ""}
              onChange={handleEditorChange}
              options={editorOptions}
              onMount={handleEditorDidMount}
            />
          </Suspense>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-3)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
            <p style={{ margin: 0, opacity: 0.7 }}>open a file from the tree →</p>
          </div>
        )}
      </div>
    </div>
  );
});