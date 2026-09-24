import { isBlockedSecretFile } from './secret-files';

/** Lower scores come first. Explicit file references outrank conventional entry points. */
export function fileContextRank(path: string, prompt: string): number {
  const lower = path.toLowerCase(); const brief = prompt.toLowerCase();
  if (brief.includes(lower) || brief.includes(lower.slice(1))) return -100;
  const words = lower.split(/[^a-z0-9]+/).filter(word => word.length > 3 && !['components', 'index', 'worker', 'server', 'styles', 'json'].includes(word));
  const matches = words.filter(word => brief.includes(word)).length;
  if (matches) return -10 * matches;
  if (/\/(?:package\.json|src\/app\.[jt]sx?|worker\/index\.ts|server\/index\.[jt]s|brainhalf\.verify\.json)$/.test(lower)) return 0;
  if (/\/(?:routes|schema|migrations)\//.test(lower)) return 2;
  if (/\.(?:test|spec)\./.test(lower)) return 4;
  return /\.(?:css|md|lock)$/.test(lower) ? 8 : 5;
}

export function contextFileAllowed(path: string): boolean {
  return !isBlockedSecretFile(path) && !/(^|\/)(?:node_modules|\.git|\.wrangler|dist|dist-worker|coverage)(\/|$)/.test(path) && !/(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(path);
}

/** Summarize file payloads, bound every turn and the total, and append the current prompt once. */
export function boundedConversation(history: Array<{ role: string; content: string }>, prompt: string, maxChars = 28_000) {
  const rows = [...history];
  const last = rows[rows.length - 1];
  if (last?.role === 'user' && last?.content.replace(/^\/plan\s+/, '').trim() === prompt.trim()) rows.pop();
  let remaining = maxChars;
  const selected: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const row of rows.reverse()) {
    if (!['user', 'assistant', 'ai'].includes(row.role)) continue;
    const role = row.role === 'user' ? 'user' : 'assistant';
    let content = String(row.content || '');
    if (role === 'assistant') content = content
      .replace(/<(?:file|edit)\s+path=["']([^"']+)["']>[\s\S]*?<\/(?:file|edit)>/gi, '[Changed $1; read current source for contents]')
      .replace(/```[\w-]*\r?\n[\s\S]*?```/g, '[Earlier code; inspect current project files]');
    const limit = Math.min(remaining, 8_000);
    if (content.length > limit) content = content.slice(0, Math.max(0, limit - 32)) + '\n[Earlier message shortened]';
    if (content) selected.push({ role, content });
    remaining -= content.length;
    if (remaining < 128) break;
  }
  return [...selected.reverse(), { role: 'user' as const, content: prompt }];
}
