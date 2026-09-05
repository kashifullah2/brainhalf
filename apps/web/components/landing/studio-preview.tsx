import { useEffect, useState } from "react";

const PROMPT = `top-down space shooter — move with the keyboard,
aim with the mouse, new waves every 12 seconds`;

const LOG_LINES = [
  { t: 0, text: "> reading your prompt…", dim: true },
  { t: 400, text: "> setting up the game", dim: true },
  { t: 900, text: "> adding player controls", dim: true },
  { t: 1400, text: "> spawning enemy waves", dim: false },
  { t: 1900, text: "> tuning difficulty", dim: false },
  { t: 2400, text: "> starting preview", dim: true },
  { t: 3200, text: "✓ ready to play", dim: false, ok: true },
];

export function StudioPreview() {
  const [visibleLines, setVisibleLines] = useState(0);
  const [cursorOn, setCursorOn] = useState(true);

  useEffect(() => {
    const timers = LOG_LINES.map((line, i) =>
      window.setTimeout(() => setVisibleLines(i + 1), line.t)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setCursorOn((v) => !v), 530);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="landing-preview" aria-hidden={false}>
      <div className="landing-preview-chrome">
        <div className="landing-preview-dots">
          <span /><span /><span />
        </div>
        <span className="landing-preview-title">studio — orbit-blaster</span>
        <span className="landing-preview-badge">2D · space shooter</span>
      </div>

      <div className="landing-preview-body">
        <aside className="landing-preview-sidebar">
          <p className="landing-preview-label">game parts</p>
          <ul>
            <li className="active">player ship</li>
            <li>enemy waves</li>
            <li>controls</li>
            <li>score</li>
          </ul>
        </aside>

        <div className="landing-preview-main">
          <div className="landing-preview-prompt">
            <span className="landing-preview-prompt-tag">you</span>
            <p>{PROMPT}</p>
          </div>

          <div className="landing-preview-log">
            {LOG_LINES.slice(0, visibleLines).map((line, i) => (
              <div
                key={i}
                className={`landing-preview-log-line ${line.ok ? "ok" : ""} ${line.dim ? "dim" : ""}`}
              >
                {line.text}
              </div>
            ))}
            {visibleLines < LOG_LINES.length && (
              <span className={`landing-preview-cursor ${cursorOn ? "on" : ""}`}>▍</span>
            )}
          </div>

          <div className="landing-preview-code">
            <p>
              <span className="cm">wave 1</span> — 3 enemies
            </p>
            <p>
              <span className="cm">wave 2</span> — 6 enemies
            </p>
            <p>
              <span className="cm">wave 3</span> — 9 enemies
            </p>
            <p className="dim">difficulty ramps every 12s</p>
          </div>
        </div>

        <div className="landing-preview-viewport">
          <div className="landing-preview-ship" />
          <p>live preview</p>
        </div>
      </div>
    </div>
  );
}
