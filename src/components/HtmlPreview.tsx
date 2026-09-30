import React, { useEffect, useRef } from 'react';
import { createPreviewModuleLoader, previewAssetUrl, previewCss } from '../lib/preview-runtime';
import { resolvePreviewImport } from '../lib/preview-modules';

/**
 * Fail-fast tracking for preview script execution (N1). The first page error
 * halts the remaining preview scripts; the halt is reported once through the
 * callback instead of stalling silently with no error or completion signal.
 */
export function createPreviewFailureTracker(onFirstFailure: (message: string) => void) {
  let failed: string | null = null;
  let reported = false;
  const messageOf = (event: ErrorEvent | PromiseRejectionEvent): string => {
    // Duck-typed so the logic is testable without a DOM: a rejection carries
    // `reason`, an error event carries `message`/`error`.
    if (event && typeof event === 'object' && 'reason' in event) {
      const reason = (event as PromiseRejectionEvent).reason;
      return reason instanceof Error ? reason.message : String(reason);
    }
    const errorEvent = event as ErrorEvent;
    return errorEvent?.error?.message || errorEvent?.message || 'Preview script failed';
  };
  return {
    markFailed(event: ErrorEvent | PromiseRejectionEvent) {
      if (failed !== null) return;
      failed = messageOf(event);
    },
    /** True when the run must stop. Reports the captured error exactly once. */
    checkFailed(): boolean {
      if (failed === null) return false;
      if (!reported) {
        reported = true;
        onFirstFailure(failed);
      }
      return true;
    },
    hasFailed(): boolean { return failed !== null; },
  };
}

/**
 * The in-page preview renames the app shell's `#root` so generated `#root`
 * CSS cannot restyle the BrainHalf UI. The rename must be undone when the
 * preview unmounts, otherwise the shell's own `html, body, #root` rules stop
 * applying for the rest of the session (L12). Returns a restore function; a
 * no-op when the host is not inside a `#root`.
 */
export function renameShellRootForPreview(host: HTMLElement): () => void {
  const runtimeRoot = host.closest('#root');
  if (!runtimeRoot) return () => {};
  const previousId = runtimeRoot.id;
  runtimeRoot.id = 'brainhalf-preview-root';
  return () => { runtimeRoot.id = previousId; };
}

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
    const restoreShellRoot = renameShellRootForPreview(host);
    let active = true;
    // N1: the first page error halts the remaining preview scripts (fail fast),
    // but the halt must be surfaced — previously the preview just stalled with
    // no error and no completion signal.
    const failureTracker = createPreviewFailureTracker(message => {
      if (active) onError(`Preview stopped after an error: ${message}`);
    });
    const markFailed = (event: ErrorEvent | PromiseRejectionEvent) => failureTracker.markFailed(event);
    const checkFailed = () => failureTracker.checkFailed();
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
        if (!active || checkFailed()) return;
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
      if (!active || checkFailed()) return;
      document.dispatchEvent(new Event('DOMContentLoaded'));
      window.dispatchEvent(new Event('load'));
      if (!failureTracker.hasFailed() && window.parent !== window) window.parent.postMessage({ type: 'preview-success' }, '*');
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
      restoreShellRoot();
    };
  }, [files, entry, libraries, onError]);
  return <div ref={container} style={{ display: 'contents' }} />;
}
