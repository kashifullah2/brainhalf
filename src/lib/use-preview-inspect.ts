import { useState, useEffect, useCallback, useRef } from 'react';
import { isAllowedOrigin } from './allowed-origins';

export interface ContextMenuState {
  x: number;
  y: number;
  tagName: string;
  id?: string;
  className?: string;
  text?: string;
}

export function usePreviewInspect(projectId: string) {
  const [inspectMode, setInspectMode] = useState(false);
  const [hoveredRect, setHoveredRect] = useState<DOMRect | null>(null);
  const inspectOverlayRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (inspectMode) return;
      e.preventDefault();
      const el = e.target as Element;
      const rawClass = typeof el.className === 'string' ? el.className.trim() : '';
      setContextMenu({
        x: e.clientX, y: e.clientY,
        tagName: el.tagName.toLowerCase(),
        id: el.id || undefined,
        className: rawClass || undefined,
        text: el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || undefined,
      });
    };
    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [inspectMode]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (e: MouseEvent) => {
      const menu = document.getElementById('bh-ctx-menu');
      if (menu && menu.contains(e.target as Node)) return;
      setContextMenu(null);
    };
    window.addEventListener('mousedown', dismiss, true);
    return () => window.removeEventListener('mousedown', dismiss, true);
  }, [contextMenu]);

  const sendContextAction = useCallback((action: string) => {
    if (!contextMenu) return;
    const { x: _x, y: _y, ...info } = contextMenu;
    setContextMenu(null);
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'element-context-action', action, ...info }, '*');
    }
  }, [contextMenu]);

  useEffect(() => {
    const handle = (e: MessageEvent) => {
      if (e.source !== window.parent || !isAllowedOrigin(e.origin)) return;
      if (e.data?.type === 'set-inspect-mode' && e.data.projectId === projectId) {
        setInspectMode(!!e.data.enabled);
        if (!e.data.enabled) setHoveredRect(null);
      }
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [projectId]);

  useEffect(() => {
    if (!inspectMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setInspectMode(false); setHoveredRect(null); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inspectMode]);

  const handleInspectMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const overlay = inspectOverlayRef.current;
    if (!overlay) return;
    overlay.style.pointerEvents = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = 'all';
    if (el && el !== overlay) setHoveredRect(el.getBoundingClientRect());
  }, [setHoveredRect]);

  const handleInspectClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const overlay = inspectOverlayRef.current;
    if (!overlay) return;
    overlay.style.pointerEvents = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = 'all';
    setInspectMode(false);
    setHoveredRect(null);
    if (!el || el === overlay) return;
    const id = el.id || undefined;
    const rawClass = typeof el.className === 'string' ? el.className.trim() : '';
    const text = el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) || undefined;
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'element-selected',
        tagName: el.tagName.toLowerCase(),
        id,
        className: rawClass || undefined,
        text,
      }, '*');
    }
  }, [setInspectMode, setHoveredRect]);

  return {
    inspectMode,
    hoveredRect,
    inspectOverlayRef,
    contextMenu,
    sendContextAction,
    handleInspectMouseMove,
    handleInspectClick,
  };
}
