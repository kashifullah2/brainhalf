import { Check, ChevronDown, FileCode2, Loader2 } from 'lucide-react';

export type FileProgress = Record<string, 'writing' | 'saved' | 'partial'>;

export default function BuildProgress({ files, progress, building, compact = false }: {
  files: string[]; progress: FileProgress; building: boolean; compact?: boolean;
}) {
  const paths = [...new Set([...Object.keys(progress), ...files])];
  const writing = paths.filter(path => progress[path] === 'writing').length;
  return <details className={`studio-build-progress${compact ? ' compact' : ''}`} open={compact ? undefined : true}>
    <summary><FileCode2 size={16} aria-hidden="true" /><span>{files.length} project files</span><small>{building ? writing ? `Writing ${writing}` : 'Building' : 'Available'}</small><ChevronDown size={15} aria-hidden="true" /></summary>
    <ul aria-label="File progress">{paths.map(path => <li key={path}>
      {progress[path] === 'writing' && building ? <Loader2 className="lucide-spin" size={14} aria-hidden="true" /> : progress[path] === 'saved' ? <Check size={14} aria-hidden="true" /> : <FileCode2 size={14} aria-hidden="true" />}
      <span title={path}>{path}</span><small>{progress[path] === 'writing' ? building ? 'Writing…' : 'Partial' : progress[path] === 'saved' ? 'Saved' : progress[path] === 'partial' ? 'Partial' : 'Available'}</small>
    </li>)}</ul>
  </details>;
}
