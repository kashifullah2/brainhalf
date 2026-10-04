import { Check, ChevronDown, FileCode2, Loader2 } from 'lucide-react';

export type FileProgress = Record<string, 'writing' | 'saved' | 'partial'>;

const INTERNAL_FILE_PATTERNS = [/brainhalf\.verify\.json$/, /^\/worker\/brainhalf\.ts$/, /^\/migrations\//, /^\/shared\//];
function isInternalFile(path: string): boolean {
  return INTERNAL_FILE_PATTERNS.some(pattern => pattern.test(path));
}

export default function BuildProgress({ files, progress, building, compact = false, agentTouched }: {
  files: string[]; progress: FileProgress; building: boolean; compact?: boolean;
  agentTouched?: ReadonlySet<string>;
}) {
  const allPaths = [...new Set([...Object.keys(progress), ...files])];
  const paths = allPaths.filter(p => !isInternalFile(p));
  const writing = allPaths.filter(path => progress[path] === 'writing').length;
  const totalCount = files.length;
  const savedCount = allPaths.filter(path => progress[path] === 'saved').length;
  return <details className={`studio-build-progress${compact ? ' compact' : ''}`} open={compact ? undefined : true}>
    <summary><FileCode2 size={16} aria-hidden="true" /><span>{totalCount} project files</span><small>{building ? writing ? `Writing ${writing} file${writing === 1 ? '' : 's'}` : savedCount < totalCount ? 'Setting up' : 'Finishing' : 'Ready'}</small><ChevronDown size={15} aria-hidden="true" /></summary>
    <ul aria-label="File progress">{paths.map(path => {
      const state = progress[path];
      const isTemplate = building && state === 'saved' && agentTouched && !agentTouched.has(path);
      return <li key={path}>
        {state === 'writing' && building ? <Loader2 className="lucide-spin" size={14} aria-hidden="true" /> : state === 'saved' && !isTemplate ? <Check size={14} aria-hidden="true" /> : <FileCode2 size={14} aria-hidden="true" />}
        <span title={path}>{path}</span><small>{state === 'writing' ? building ? 'Writing…' : 'Partial' : isTemplate ? 'Starting point' : state === 'saved' ? 'Saved' : state === 'partial' ? 'Partial' : 'Unchanged'}</small>
      </li>;
    })}</ul>
  </details>;
}
