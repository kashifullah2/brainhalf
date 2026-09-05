// Studio client component

import { useStudioStore, FileNode } from "@stores/studio-store";
import {
  createProjectFile,
  createProjectFolder,
  deleteProjectNode,
  renameProjectNode,
  parentFolderIdForNode,
} from "@lib/file-ops";
import { Folder, FileCode, FileJson, FileImage, FileText, Plus, Trash2, Pencil, FilePlus, FolderPlus } from "lucide-react";
import { useState, memo, useMemo, useCallback, useRef, CSSProperties } from "react";

const getFileIcon = (name: string, type: string) => {
  if (type === "folder") return <Folder size={15} color="#3b82f6" />;
  if (name.endsWith(".html")) return <FileCode size={15} color="#f97316" />;
  if (name.endsWith(".js") || name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".jsx"))
    return <FileJson size={15} color="#facc15" />;
  if (name.match(/\.(jpg|png|webp|svg|gif)$/i)) return <FileImage size={15} color="#c084fc" />;
  return <FileText size={15} color="var(--text-2)" />;
};

export const FileExplorer = memo(function FileExplorer() {
  const projectFiles = useStudioStore((state) => state.projectFiles);
  const activeFileId = useStudioStore((state) => state.activeFileId);
  const openFile = useStudioStore((state) => state.openFile);

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(["1", "3", "6"]),
  );
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [contextFileId, setContextFileId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const childrenMap = useMemo(() => {
    const map = new Map<string, FileNode[]>();
    projectFiles.forEach((file) => {
      const parentId = file.parentId || "root";
      if (!map.has(parentId)) map.set(parentId, []);
      map.get(parentId)!.push(file);
    });
    return map;
  }, [projectFiles]);

  const roots = childrenMap.get("root") || [];

  const expandFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => new Set(prev).add(folderId));
  }, []);

  const toggleFolder = useCallback((folderId: string) => {
    setExpandedFolders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) newSet.delete(folderId);
      else newSet.add(folderId);
      return newSet;
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, fileId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextFileId(fileId);
    setContextMenu({ x: e.clientX, y: e.clientY });
    setAddMenuOpen(false);
  }, []);

  const closeMenus = useCallback(() => {
    setContextMenu(null);
    setContextFileId(null);
    setAddMenuOpen(false);
  }, []);

  const handleNewFile = useCallback(
    async (explicitParent?: string | null) => {
      const parent =
        explicitParent !== undefined
          ? explicitParent
          : contextFileId
            ? parentFolderIdForNode(projectFiles, contextFileId)
            : null;
      const id = await createProjectFile(parent, "untitled.js");
      if (id && parent) expandFolder(parent);
      closeMenus();
    },
    [contextFileId, projectFiles, expandFolder, closeMenus],
  );

  const handleNewFolder = useCallback(
    async (explicitParent?: string | null) => {
      const parent =
        explicitParent !== undefined
          ? explicitParent
          : contextFileId
            ? parentFolderIdForNode(projectFiles, contextFileId)
            : null;
      const id = await createProjectFolder(parent, "new-folder");
      if (id) {
        expandFolder(id);
        if (parent) expandFolder(parent);
      }
      closeMenus();
    },
    [contextFileId, projectFiles, expandFolder, closeMenus],
  );

  const handleRename = useCallback(async () => {
    if (!contextFileId) return;
    const node = projectFiles.find((f) => f.id === contextFileId);
    if (!node) return;
    const next = window.prompt("Rename to:", node.name);
    if (next && next !== node.name) {
      await renameProjectNode(contextFileId, next);
    }
    closeMenus();
  }, [contextFileId, projectFiles, closeMenus]);

  const handleDelete = useCallback(async () => {
    if (!contextFileId) return;
    const node = projectFiles.find((f) => f.id === contextFileId);
    if (!node) return;
    const label = node.type === "folder" ? "folder and its contents" : node.name;
    if (window.confirm(`Delete ${label}?`)) {
      await deleteProjectNode(contextFileId);
    }
    closeMenus();
  }, [contextFileId, projectFiles, closeMenus]);

  const renderTree = useCallback(
    (files: FileNode[], depth = 0) => {
      return files.map((file) => {
        const children = childrenMap.get(file.id) || [];
        const isActive = activeFileId === file.id;
        const isExpanded = expandedFolders.has(file.id);
        const isFolder = file.type === "folder";

        const rowStyle: CSSProperties = {
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "5px 12px",
          paddingLeft: 12 + depth * 14,
          cursor: "pointer",
          fontSize: 13,
          color: isActive ? "var(--text)" : "var(--text-2)",
          background: isActive ? "var(--accent-muted)" : "transparent",
          borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
          transition: "background 100ms, color 100ms",
          userSelect: "none",
          minWidth: 0,
        };

        return (
          <div key={file.id}>
            <div
              style={rowStyle}
              onClick={() => (isFolder ? toggleFolder(file.id) : openFile(file.id))}
              onContextMenu={(e) => handleContextMenu(e, file.id)}
            >
              {getFileIcon(file.name, file.type)}
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                  fontWeight: isActive ? 500 : 400,
                }}
              >
                {file.name}
              </span>
              {file.isDirty && (
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--text-2)",
                    flexShrink: 0,
                  }}
                />
              )}
            </div>

            {isFolder && isExpanded && children.length > 0 && renderTree(children, depth + 1)}
          </div>
        );
      });
    },
    [activeFileId, childrenMap, expandedFolders, handleContextMenu, openFile, toggleFolder],
  );

  const menuItemStyle: CSSProperties = {
    padding: "6px 16px",
    fontSize: 13,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "var(--text)",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: "var(--panel-left)",
        position: "relative",
      }}
      onClick={closeMenus}
    >
      <div className="studio-panel-header">
        <span className="studio-panel-label">files</span>
        <button
          ref={addBtnRef}
          type="button"
          style={{
            background: "none",
            border: "none",
            color: "var(--text-2)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
          }}
          title="New file or folder"
          onClick={(e) => {
            e.stopPropagation();
            setAddMenuOpen((o) => !o);
            setContextMenu(null);
          }}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* + dropdown — new at project root */}
      {addMenuOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 36,
            right: 8,
            zIndex: 100,
            background: "var(--bg-3)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "4px 0",
            minWidth: 160,
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          }}
        >
          <div style={menuItemStyle} onClick={() => void handleNewFile(null)}>
            <FilePlus size={14} /> New File
          </div>
          <div style={menuItemStyle} onClick={() => void handleNewFolder(null)}>
            <FolderPlus size={14} /> New Folder
          </div>
        </div>
      )}

      <div className="studio-file-tree">
        {roots.length === 0 ? (
          <div
            style={{
              padding: "20px 14px",
              color: "var(--text-3)",
              fontSize: 12,
              lineHeight: 1.5,
              fontFamily: "var(--font-mono)",
            }}
          >
            empty tree — use + or ask the agent to create files
          </div>
        ) : (
          renderTree(roots)
        )}
      </div>

      {contextMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 100,
            background: "var(--bg-3)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "4px 0",
            minWidth: 180,
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          }}
        >
          <div style={menuItemStyle} onClick={() => void handleNewFile()}>
            <FilePlus size={14} /> New File
          </div>
          <div style={menuItemStyle} onClick={() => void handleNewFolder()}>
            <FolderPlus size={14} /> New Folder
          </div>
          <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
          <div style={menuItemStyle} onClick={() => void handleRename()}>
            <Pencil size={14} /> Rename
          </div>
          <div
            style={{ ...menuItemStyle, color: "var(--red)" }}
            onClick={() => void handleDelete()}
          >
            <Trash2 size={14} /> Delete
          </div>
        </div>
      )}
    </div>
  );
});
