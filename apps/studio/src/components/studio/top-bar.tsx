import { useStudioStore } from "@stores/studio-store";
import { Play, Download, Share2, Rocket, ExternalLink } from "lucide-react";
import { apiUrl, getWebUrl } from "@lib/api";
import { VersionHistory } from "./version-history";

interface TopBarProps {
  viewMode?: "Preview" | "Code";
  setViewMode?: (mode: "Preview" | "Code") => void;
}

export function TopBar({ viewMode = "Preview", setViewMode }: TopBarProps) {
  const projectTitle = useStudioStore((s) => s.projectTitle);
  const setProjectTitle = useStudioStore((s) => s.setProjectTitle);
  const gameType = useStudioStore((s) => s.gameType);
  const saveStatus = useStudioStore((s) => s.saveStatus);
  const projectId = useStudioStore((s) => s.projectId);
  const credits = useStudioStore((s) => s.credits);

  const webUrl = getWebUrl();

  const handleExport = async () => {
    if (!projectId) return;
    try {
      const res = await fetch(apiUrl(`/api/projects/${projectId}/export`), {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${projectTitle || "project"}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Export failed:", err);
    }
  };

  return (
    <header className="studio-topbar">
      <div className="studio-topbar-left">
        <a href={webUrl} className="studio-brand" title="Back to BrainHalf">
          <span className="studio-brand-dot" />
          brainhalf
        </a>
        <input
          type="text"
          className="studio-title-input"
          value={projectTitle}
          onChange={(e) => setProjectTitle(e.target.value)}
          aria-label="Project title"
        />
        <span className="studio-badge">{gameType}</span>
        <span className={`studio-save-hint ${saveStatus !== "Saved" ? "unsaved" : ""}`}>
          {saveStatus === "Saved" ? "saved" : "unsaved"}
        </span>
        <span className="studio-credits-hint" title="AI credits remaining">
          {credits} cr
        </span>
      </div>

      <div className="studio-segment">
        <button
          type="button"
          className={viewMode === "Preview" ? "active" : ""}
          onClick={() => setViewMode?.("Preview")}
        >
          Preview
        </button>
        <button
          type="button"
          className={viewMode === "Code" ? "active" : ""}
          onClick={() => setViewMode?.("Code")}
        >
          Code
        </button>
      </div>

      <div className="studio-topbar-right">
        <button type="button" className="studio-btn" title="Run dev server">
          <Play size={14} /> Run
        </button>
        <button type="button" className="studio-btn" onClick={handleExport}>
          <Download size={14} /> Export
        </button>
        <VersionHistory />
        <button type="button" className="studio-btn">
          <Share2 size={14} /> Share
        </button>
        <a
          href={`${webUrl}/settings`}
          target="_blank"
          rel="noreferrer"
          className="studio-btn"
        >
          <ExternalLink size={14} /> Settings
        </a>
        <span className="studio-divider-v" />
        <button type="button" className="studio-btn studio-btn-primary">
          <Rocket size={14} /> Publish
        </button>
      </div>
    </header>
  );
}
