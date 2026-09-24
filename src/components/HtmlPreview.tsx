import React, { useEffect, useRef } from 'react';
import { createPreviewModuleLoader, previewAssetUrl, previewCss } from '../lib/preview-runtime';
import { resolvePreviewImport } from '../lib/preview-modules';

export function HtmlPreview({ files, entry, libraries, onError }: {
  files: Record<string, string>;
  entry: string;
  libraries: Record<string, unknown>;
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = container.current;
    if (!host) return;
    const runtimeRoot = host.closest('#root');
    if (runtimeRoot) runtimeRoot.id = 'brainhalf-preview-root';
    let active = true;
    let failed = false;
    const markFailed = () => { failed = true; };
    window.addEventListener('error', markFailed);
    window.addEventListener('unhandledrejection', markFailed);
    const headNodes: Element[] = [];
    const source = new DOMParser().parseFromString(files[entry], 'text/html');
    const scripts = Array.from(source.querySelectorAll('script'));
    for (const script of scripts) script.remove();
    for (const link of source.querySelectorAll('link[rel="stylesheet"]')) {
      const address = link.getAttribute('href');
      const path = address ? resolvePreviewImport(files, entry, address) : null;
      if (path) {
        const style = document.createElement('style');
        style.textContent = previewCss(files, path, files[path]);
        link.replaceWith(style);
      }
    }
    for (const element of source.querySelectorAll('[src], [href], [poster]')) {
      for (const attribute of ['src', 'href', 'poster']) {
        const value = element.getAttribute(attribute);
        if (value && !value.startsWith('#')) element.setAttribute(attribute, previewAssetUrl(files, entry, value));
      }
    }
    for (const style of source.querySelectorAll('style')) style.textContent = previewCss(files, entry, style.textContent || '');
    for (const element of Array.from(source.head.children)) {
      if (!['STYLE', 'LINK', 'TITLE'].includes(element.tagName)) continue;
      document.head.append(element);
      headNodes.push(element);
    }
    host.replaceChildren(...Array.from(source.body.childNodes));
    const previousClass = document.body.className;
    const previousStyle = document.body.getAttribute('style');
    document.body.className = source.body.className;
    document.body.style.cssText = source.body.style.cssText;
    const loader = createPreviewModuleLoader(files, libraries, React);
    const execute = async () => {
      for (const [index, script] of scripts.entries()) {
        if (!active || failed) return;
        const type = script.getAttribute('type') || '';
        if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) {
          host.append(script);
          continue;
        }
        const address = script.getAttribute('src');
        const path = address ? resolvePreviewImport(files, entry, address) : `${entry}.inline-${index}.js`;
        if (address && !path && !/^https?:\/\//.test(address)) throw new Error(`Cannot resolve script "${address}" imported from "${entry}"`);
        const code = address && path ? files[path] : script.textContent || '';
        if (type === 'module' && path) {
          loader.execute(path, code);
        } else {
          const executable = document.createElement('script');
          if (type) executable.type = type;
          if (address && !path) {
            executable.src = address;
            await new Promise<void>((resolve, reject) => {
              executable.onload = () => resolve();
              executable.onerror = () => reject(new Error(`Failed to load script "${address}"`));
              host.append(executable);
            });
          } else {
            executable.textContent = code;
            host.append(executable);
          }
        }
      }
      if (!active || failed) return;
      document.dispatchEvent(new Event('DOMContentLoaded'));
      window.dispatchEvent(new Event('load'));
      if (!failed && window.parent !== window) window.parent.postMessage({ type: 'preview-success' }, window.location.origin);
    };
    void execute().catch(error => { if (active) onError(error instanceof Error ? error.message : String(error)); });
    return () => {
      active = false;
      window.removeEventListener('error', markFailed);
      window.removeEventListener('unhandledrejection', markFailed);
      host.replaceChildren();
      for (const element of headNodes) element.remove();
      document.body.className = previousClass;
      if (previousStyle === null) document.body.removeAttribute('style');
      else document.body.setAttribute('style', previousStyle);
    };
  }, [files, entry, libraries, onError]);
  return <div ref={container} style={{ display: 'contents' }} />;
}
