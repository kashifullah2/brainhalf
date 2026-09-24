import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Monitor, RotateCcw, Smartphone, Tablet } from 'lucide-react';
import './PreviewCanvas.css';

type ViewportMode = 'desktop' | 'tablet' | 'mobile';

export default function PreviewCanvas({ mode, onModeChange, onRefresh, onOpen, ready, openReady = ready, children }: {
  mode: ViewportMode;
  onModeChange: (mode: ViewportMode) => void;
  onRefresh: () => void;
  onOpen: () => void;
  ready: boolean;
  openReady?: boolean;
  children: ReactNode;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState('fit');
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Changing device starts fitted; a prior 100% phone view must not strand a tablet off-screen.
  const changeMode = (next: ViewportMode) => { setZoom('fit'); onModeChange(next); };
  const width = mode === 'tablet' ? 768 : 375;
  const height = mode === 'tablet' ? 1024 : 812;
  const fitScale = Math.max(.05, Math.min(1, size.width / (width + 12), size.height / (height + 12)));
  const scale = zoom === 'fit' ? fitScale : Number(zoom);
  const dimensions = mode === 'desktop'
    ? `${Math.max(0, Math.round(size.width))} × ${Math.max(0, Math.round(size.height))}`
    : `${width} × ${height}`;

  return <div className={`preview-canvas preview-canvas-${mode}`}>
    <div className="preview-canvas-toolbar">
      <div className="viewport-segmented-control" role="group" aria-label="Preview screen size">
        {([
          ['desktop', 'Desktop view', Monitor],
          ['tablet', 'Tablet view (768px)', Tablet],
          ['mobile', 'Mobile view (375px)', Smartphone],
        ] as const).map(([value, label, Icon]) => <button type="button" key={value}
          className={`viewport-pill-btn${mode === value ? ' active' : ''}`}
          aria-label={label} title={label} aria-pressed={mode === value} onClick={() => changeMode(value)}><Icon size={18} strokeWidth={1.7} /></button>)}
      </div>
      <span className="preview-canvas-dimensions" title={`Preview dimensions: ${dimensions} pixels`}>{mode === 'desktop' && <span>Responsive <span aria-hidden="true">·</span> </span>}{dimensions}</span>
      <div className="preview-canvas-tools">
        {mode !== 'desktop' && <select aria-label="Preview zoom" value={zoom} onChange={event => setZoom(event.target.value)}>
          <option value="fit">Fit · {Math.round(fitScale * 100)}%</option>
          <option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option>
        </select>}
        <button type="button" className="studio-preview-refresh" title="Refresh preview" aria-label="Refresh preview" disabled={!ready} onClick={onRefresh}><RotateCcw size={16} /></button>
        <button type="button" className="studio-preview-popout" title="Open preview in a new tab" aria-label="Open preview in a new tab" disabled={!openReady} onClick={onOpen}><ArrowUpRight size={18} /></button>
      </div>
    </div>
    <div ref={canvas} className="preview-canvas-scroll">
      <div className="preview-device-space" style={mode === 'desktop' ? undefined : { width: (width + 12) * scale, height: (height + 12) * scale }}>
        <div className={`preview-device preview-device-${mode}`} style={mode === 'desktop' ? undefined : { width: width + 12, height: height + 12, transform: `scale(${scale})` }}>{children}</div>
      </div>
    </div>
  </div>;
}
