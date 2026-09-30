import { ChevronDown, Wrench } from 'lucide-react';
import { TOOL_LABELS } from '../lib/chat-transcript';

export default function ToolSummary({ names, active }: { names: string[]; active: boolean }) {
  const reading = active && names.every(name => /read|list|search/.test(name));
  return <details className="studio-tool-summary">
    <summary><Wrench size={15} aria-hidden="true" /><span>{reading ? 'The builder is reading files…' : `The builder used tools (${names.length})`}</span><ChevronDown size={15} aria-hidden="true" /></summary>
    <ul>{names.map((name, index) => <li key={`${index}-${name}`}>{TOOL_LABELS[name] || (name.startsWith('mcp_') ? 'Used a connected service' : 'Used a project tool')}</li>)}</ul>
  </details>;
}
