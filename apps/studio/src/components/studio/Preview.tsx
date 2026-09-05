import { useState, memo, useRef, useMemo } from "react";
import { RotateCw, Maximize2, Monitor, Smartphone, AlertCircle, Play } from "lucide-react";
import { useWebContainer } from "../../hooks/useWebContainer";
import { useStudioStore } from "@stores/studio-store";
import { buildPreviewSrc } from "../../lib/preview-sync";

interface PreviewProps {
  /** Sidebar embed: parent supplies outer chrome */
  compact?: boolean;
}

function PreviewIdle() {
  return (
    <div className="studio-preview-idle">
      <div className="studio-preview-orbit" aria-hidden>
        <span className="studio-orbit-dot" />
        <span className="studio-orbit-dot" />
        <span className="studio-orbit-dot" />
        <span className="studio-orbit-dot" />
        <span className="studio-preview-play">
          <Play size={18} fill="currentColor" strokeWidth={0} />
        </span>
      </div>
      <p className="studio-preview-idle-title">Generate a game to see it live here</p>
      <p className="studio-preview-idle-sub">Describe your game in the agent chat</p>
    </div>
  );
}

export function Preview({ compact = false }: PreviewProps) {
  const { previewUrl, isBooted, initPhase, isNpmInstalling, error } = useWebContainer();
  const previewPath = useStudioStore((state) => state.previewPath);
  const previewReloadKey = useStudioStore((state) => state.previewReloadKey);
  const bumpPreviewReload = useStudioStore((state) => state.bumpPreviewReload);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const iframeSrc = useMemo(
    () => (previewUrl ? buildPreviewSrc(previewUrl, previewPath) : null),
    [previewUrl, previewPath],
  );

  const handleReload = () => {
    bumpPreviewReload();
    setIframeLoaded(false);
  };

  const handleFullscreen = () => {
    if (iframeSrc) window.open(iframeSrc, "_blank");
  };

  const showIdle = isBooted && !previewUrl && !error && initPhase === 'idle';
  const showStarting =
    isBooted && !previewUrl && !error && initPhase === 'starting-preview';
  const showInstalling =
    isBooted && !previewUrl && !error && initPhase === 'installing';

  return (
    <div className={`studio-preview-root ${compact ? "compact" : ""}`}>
      <div className="studio-panel-header">
        <span className="studio-panel-label">preview</span>
        <div className="studio-preview-toolbar">
          {previewUrl && (
            <span className="studio-preview-live">
              <span className="studio-preview-live-dot" />
              live
            </span>
          )}
          <button
            type="button"
            className={`studio-icon-btn ${device === "desktop" ? "active" : ""}`}
            onClick={() => setDevice("desktop")}
            title="Desktop"
          >
            <Monitor size={13} />
          </button>
          <button
            type="button"
            className={`studio-icon-btn ${device === "mobile" ? "active" : ""}`}
            onClick={() => setDevice("mobile")}
            title="Mobile"
          >
            <Smartphone size={13} />
          </button>
          <button type="button" className="studio-icon-btn" onClick={handleReload} title="Reload">
            <RotateCw size={13} />
          </button>
          <button type="button" className="studio-icon-btn" onClick={handleFullscreen} title="Open tab">
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      <div className="studio-preview-viewport">
        {!isBooted && !error && (
          <div className="studio-preview-state">
            <span className="studio-boot-dot" />
            <span>booting webcontainer…</span>
          </div>
        )}

        {isBooted && initPhase === 'booting' && !previewUrl && !error && (
          <div className="studio-preview-state">
            <span className="studio-boot-dot" />
            <span>booting webcontainer…</span>
          </div>
        )}

        {showStarting && (
          <div className="studio-preview-state">
            <span className="studio-boot-dot" />
            <span>starting preview…</span>
          </div>
        )}

        {showInstalling && (
          <div className="studio-preview-state">
            <span className="studio-boot-dot" />
            <span>installing dependencies…</span>
          </div>
        )}

        {showIdle && <PreviewIdle />}

        {error && (
          <div className="studio-preview-state studio-preview-error">
            <AlertCircle size={22} />
            <span>{error}</span>
          </div>
        )}

        {previewUrl && (
          <div className={`studio-preview-device ${device === "mobile" ? "mobile" : ""}`}>
            {isNpmInstalling && (
              <div className="studio-preview-upgrade-banner" title="Full dev server with HMR loading in background">
                upgrading preview…
              </div>
            )}
            {!iframeLoaded && (
              <div className="studio-preview-iframe-loading">
                <span className="studio-boot-dot" />
              </div>
            )}
            <iframe
              ref={iframeRef}
              key={`${previewReloadKey}-${previewPath}`}
              src={iframeSrc ?? undefined}
              onLoad={() => setIframeLoaded(true)}
              title="Game preview"
              className="studio-preview-iframe"
              sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-popups allow-presentation"
              allow="accelerometer; camera; encrypted-media; geolocation; gyroscope; microphone; midi; clipboard-read; clipboard-write"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export const MemoizedPreview = memo(Preview);
