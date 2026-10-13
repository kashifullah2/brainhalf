/**
 * S2/S4 reproduction (AUDIT ONLY — outside product code, NOT in `npm test`).
 *
 * Questions:
 *  - S4: does the model know which files are ALREADY in its context? Does
 *        `inspectedFiles` get populated from the workspace context block?
 *  - S2: how much of a 10/30/60-file project actually reaches the model?
 *
 * Run: npx vitest run --config docs/audits/vitest.audit.config.ts
 */
import { describe, it } from 'vitest';
import { buildSystemPrompt, buildSystemPromptParts } from '../../src/lib/system-prompt';
import { boundedConversation, estimateTokens, fileContextRank } from '../../src/lib/agent-context';
import { generationContextLimits } from '../../src/lib/generation-controls';
import { checkShrinkage } from '../../src/lib/write-guard';

const PINNED = new Set(['/src/App.tsx', '/src/App.jsx', '/package.json', '/worker/index.ts', '/brainhalf.verify.json']);

/** Build a realistic project of N files. */
function project(n: number) {
  const files = new Map<string, string>();
  const put = (p: string, lines: number) => files.set(p, Array.from({ length: lines }, (_, i) => `// line ${i + 1} of ${p}`).join('\n'));
  put('/package.json', 40);
  put('/src/App.tsx', 120);
  put('/worker/index.ts', 260);
  put('/brainhalf.verify.json', 30);
  put('/shared/types.ts', 60);
  put('/src/styles.css', 200);
  put('/migrations/0001_items.sql', 20);
  put('/worker/backend.test.mjs', 90);
  for (let i = 0; i < n - 8; i++) put(`/src/components/Comp${i}.tsx`, 90 + (i % 40));
  return files;
}

/** Mirror of ChatAgent.buildFilesContext (src/agent.ts:762-832). */
function buildFilesContext(files: Map<string, string>, prompt: string, maxFiles: number, charBudget: number) {
  const mentioned = new Set<string>();
  const isPriority = (p: string) => PINNED.has(p) || mentioned.has(p);
  const rank = (p: string) => fileContextRank(p, prompt);
  const priorityPaths = [...files.keys()].filter(isPriority).sort((a, b) => rank(a) - rank(b)).slice(0, maxFiles);
  const otherPaths = [...files.keys()].filter(p => !isPriority(p)).sort((a, b) => rank(a) - rank(b)).slice(0, 300);
  let budget = charBudget;
  const parts: string[] = [];
  let truncated = false;
  for (const p of priorityPaths) {
    const source = files.get(p)!;
    const content = source.length > 16_000 ? source.slice(0, 16_000) + '\n[File shortened]' : source;
    if (content.length > budget) { parts.push(`File: ${p}\n\`\`\`\n${content.slice(0, budget)}\n// ... [trimmed for length]\n\`\`\``); truncated = true; break; }
    budget -= content.length;
    parts.push(`File: ${p}\n\`\`\`\n${content}\n\`\`\``);
  }
  if (otherPaths.length) parts.push(`OTHER PROJECT FILES (use read_file to view):\n${otherPaths.join('\n')}`);
  return { text: `\n\nCURRENT PROJECT BASELINE FILES:\n${parts.join('\n\n')}\n`, truncated, withContent: priorityPaths.length, listedOnly: otherPaths.length };
}

describe('S2/S4 — what the model actually sees, and what it is told to re-read', () => {
  it('measures the context block for 10 / 30 / 60 file projects', () => {
    const lines: string[] = ['=== S2: workspace context size per project (fastMode = DEFAULT) ==='];
    for (const n of [10, 30, 60]) {
      const limits = generationContextLimits(true); // DEFAULT_RELIABILITY.fastMode === true
      const files = project(n);
      const ctx = buildFilesContext(files, 'fix the layout and css', limits.maxFiles, limits.sourceChars);
      const prompt = buildSystemPrompt({ filesContext: ctx.text, plannerMode: false });
      const { staticPart, dynamicPart } = buildSystemPromptParts({ filesContext: ctx.text, plannerMode: false });
      lines.push('');
      lines.push(`--- ${n} files (maxFiles=${limits.maxFiles}, sourceChars=${limits.sourceChars}, historyTokens=${limits.historyTokens}) ---`);
      lines.push(`files in project        : ${files.size}`);
      lines.push(`files WITH content      : ${ctx.withContent}   (pinned + prompt-mentioned only)`);
      lines.push(`files PATH-ONLY         : ${ctx.listedOnly}`);
      lines.push(`char budget exhausted?  : ${ctx.truncated}`);
      lines.push(`staticPart tokens       : ~${estimateTokens(staticPart)}`);
      lines.push(`dynamicPart tokens      : ~${estimateTokens(dynamicPart)}`);
      lines.push(`TOTAL system prompt     : ~${estimateTokens(prompt)}  (chars=${prompt.length})`);
    }
    console.log('\n' + lines.join('\n') + '\n');
  }, 120_000);

  it('S4: the prompt says "do not re-read", but write_file DEMANDS a re-read', () => {
    const files = project(30);
    const ctx = buildFilesContext(files, 'fix the layout', 20, 24_000);
    const prompt = buildSystemPrompt({ filesContext: ctx.text, plannerMode: false });

    const saysDoNotReread = /Do not re-read files whose contents you already have\./.test(prompt);
    const saysOnlySeeContext = /You can only see what the workspace context contains/.test(prompt);

    // agent-tools.ts:113-115 — the guard.
    // inspectedFiles is populated ONLY by read_file (agent-tools.ts:173) and by a
    // successful write (agent-tools.ts:137). It is NEVER populated from filesContext.
    const existing = files.get('/src/App.tsx')!;
    const inspectedFiles = new Map<string, string>(); // empty: content came from the prompt, not a tool
    const guardRejects = inspectedFiles.get('/src/App.tsx') !== existing;

    const lines = [
      '=== S4: prompt vs. write guard ===',
      `prompt says "Do not re-read files whose contents you already have." : ${saysDoNotReread}`,
      `prompt says "You can only see what the workspace context contains"   : ${saysOnlySeeContext}`,
      '',
      'inspectedFiles is created EMPTY per generation (generation-pipeline.ts:802):',
      "    const inspectedFiles = new Map<string, string>();",
      'and is filled only by read_file (agent-tools.ts:173) / a successful write (agent-tools.ts:137).',
      'The content buildFilesContext put in the system prompt does NOT populate it.',
      '',
      `So write_file on /src/App.tsx (content already visible in the prompt) -> guard rejects? ${guardRejects}`,
      '  message: "Read the complete current file before changing it. It may have changed since your last read."',
      '',
      'For any file NOT in the pinned 5 and not ranked into maxFiles, the block lists it PATH-ONLY,',
      'so the model has zero bytes of it — the same guard then also forces a read_file first.',
    ];
    console.log('\n' + lines.join('\n') + '\n');
  }, 120_000);

  it('history truncation order (boundedConversation)', () => {
    const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i} `.repeat(300) }));
    const limits = generationContextLimits(true);
    const selected = boundedConversation(history as any, 'fix the layout', limits.historyTokens);
    const tokens = selected.slice(0, -1).reduce((s, r) => s + estimateTokens(r.content), 0);
    console.log('\n=== boundedConversation (fastMode historyTokens=' + limits.historyTokens + ') ===');
    console.log(`input turns            : ${history.length}  (SQL LIMIT 12, generation-pipeline.ts:636)`);
    console.log(`turns kept in context  : ${selected.length - 1} + the new prompt`);
    console.log(`tokens spent           : ~${tokens}`);
    console.log(`per-row hard cap       : 2300 tokens (agent-context.ts:44) - older turns cut mid-sentence`);
    console.log(`drop order             : NEWEST-FIRST (rows.reverse() then break on budget, agent-context.ts:35-53)`);
    console.log('');
  }, 120_000);
});
