/**
 * Prompt inventory + token sizes (AUDIT ONLY).
 *
 * Run: npx vitest run --config docs/audits/vitest.audit.config.ts
 */
import { describe, it } from 'vitest';
import { buildSystemPrompt, buildSystemPromptParts } from '../../src/lib/system-prompt';
import { estimateTokens } from '../../src/lib/agent-context';
import {
  COMPLETENESS_REPAIR_MARKER,
  PHANTOM_HOOK_REPAIR_MARKER,
  VERIFY_FILE_REPAIR_MARKER,
  ROUTE_COVERAGE_REPAIR_MARKER,
  APP_ENTRY_REPAIR_MARKER,
} from '../../src/lib/generation-pipeline';
import { AUTO_RETRY_FULL_APP_MARKER, TRUNCATION_RETRY_MESSAGE } from '../../src/lib/file-extractor';

const MODES: Array<[string, any]> = [
  ['NEW managed app', { filesContext: '', plannerMode: false, isFreshBuild: true, executionTarget: 'managed' }],
  ['EDIT managed app', { filesContext: '', plannerMode: false, isFreshBuild: false, isIncrementalEdit: true, executionTarget: 'managed' }],
  ['NEW export app', { filesContext: '', plannerMode: false, isFreshBuild: true, executionTarget: 'export' }],
  ['EDIT export app', { filesContext: '', plannerMode: false, isFreshBuild: false, isIncrementalEdit: true, executionTarget: 'export' }],
  ['PLANNER', { filesContext: '', plannerMode: true }],
  ['QUESTION', { filesContext: '', plannerMode: false, questionMode: true }],
  ['DESTRUCTIVE', { filesContext: '', plannerMode: false, destructiveMode: true }],
  ['AMBIGUOUS', { filesContext: '', plannerMode: false, ambiguousMode: true }],
];

describe('prompt inventory and token sizes', () => {
  it('measures every prompt variant', () => {
    const lines = ['=== PROMPT INVENTORY (src/lib/system-prompt.ts, 549 lines) ==='];
    for (const [label, opts] of MODES) {
      const { staticPart, dynamicPart } = buildSystemPromptParts(opts);
      const full = buildSystemPrompt(opts);
      lines.push(`${label.padEnd(19)} static=${String(estimateTokens(staticPart)).padStart(6)}  dynamic=${String(estimateTokens(dynamicPart)).padStart(5)}  TOTAL=${String(estimateTokens(full)).padStart(6)}  (${full.length} chars)`);
    }
    lines.push('');
    lines.push('staticPart depends only on executionTarget x toolsAvailable (system-prompt.ts:12-16).');
    console.log('\n' + lines.join('\n') + '\n');
  }, 120_000);

  it('lists every repair / resume / retry instruction string', () => {
    const rows: Array<[string, string, string]> = [
      ['truncation retry', 'src/lib/file-extractor.ts:49', TRUNCATION_RETRY_MESSAGE],
      ['auto-retry marker', 'src/lib/file-extractor.ts:51', AUTO_RETRY_FULL_APP_MARKER],
      ['auto-retry message', 'src/lib/file-extractor.ts:184-188', AUTO_RETRY_FULL_APP_MARKER + ' Your previous response contained NO <file> blocks - only markdown prose or code fences. That response is being discarded. Start over. You MUST output ONLY complete <file path="/...">FULL FILE CONTENT</file> blocks. No markdown, no explanation, no code fences, no prose of any kind before or after the file blocks. Tool use is disabled for this response. Do not emit DSML, function-call markup, or any XML other than <file>, <edit>, and <delete> tags. Generate EVERY file needed for a complete, runnable application. Do not truncate any file. Do not write partial implementations or placeholders.'],
      ['FILE-OUTPUT RECOVERY', 'src/lib/generation-pipeline.ts:831', 'FILE-OUTPUT RECOVERY: Tool use is disabled for this response. Work from the supplied project source and conversation. Do not emit DSML, function calls, or a plan to inspect files. Return the requested implementation as complete <file path="/...">content</file> blocks. Never claim you ran a tool.'],
      ['DIRECT GENERATION fresh', 'src/lib/generation-pipeline.ts:989', 'DIRECT GENERATION: Tool use is disabled. Return the complete implementation as <file path="/...">content</file> blocks in a single response. Write ALL files needed for a working app. Do not emit function calls or plan to inspect files.'],
      ['DIRECT GENERATION edit', 'src/lib/generation-pipeline.ts:991', 'DIRECT GENERATION: Tool use is disabled. You can only see the workspace context above. Change existing files with <edit> blocks (search/replace). Create only genuinely new files with <file> blocks. Never rewrite a file you cannot see in full - say what is missing instead. Do not emit function calls.'],
      ['STAGE 1 extra prompt', 'src/lib/generation-pipeline.ts:958', 'STAGE 1 INSTRUCTION: Write ONLY schema/migration files, shared contract types, and config files (e.g. migrations/*.sql, shared/*.ts, package.json). Do NOT write App.tsx, any /src/components/*.tsx files, or worker/index.ts yet.'],
      ['STAGE 2 extra prompt', 'src/lib/generation-pipeline.ts:959', 'STAGE 2 INSTRUCTION: Write ALL frontend files. Start with /src/App.tsx FIRST (mandatory write order), then write EVERY component file it imports - all /src/components/*.tsx. Write every sub-import too. Do NOT write worker/index.ts or backend routes yet.'],
      ['STAGE 3 extra prompt', 'src/lib/generation-pipeline.ts:960', 'STAGE 3 INSTRUCTION: Write the backend: worker/index.ts routes and any remaining files. All frontend files must already be written before this stage.'],
      ['maxSteps exhaustion', 'src/lib/generation-pipeline.ts:1109', 'The tool phase is complete. Finish the original task using the results above. Return remaining implementation as complete file blocks. Report any checks that still need to run.'],
      ['stage continuation', 'src/lib/generation-pipeline.ts:1272', 'Great. Proceed to the next stage and output the remaining files. Ensure you use the exact same architecture.'],
      ['completeness repair', 'src/lib/generation-pipeline.ts:72', COMPLETENESS_REPAIR_MARKER],
      ['phantom-hook repair', 'src/lib/generation-pipeline.ts:73', PHANTOM_HOOK_REPAIR_MARKER],
      ['verify-file repair', 'src/lib/generation-pipeline.ts:74', VERIFY_FILE_REPAIR_MARKER],
      ['route-coverage repair', 'src/lib/generation-pipeline.ts:75', ROUTE_COVERAGE_REPAIR_MARKER],
      ['app-entry repair', 'src/lib/generation-pipeline.ts:76', APP_ENTRY_REPAIR_MARKER],
      ['syntax repair prompt', 'src/lib/file-extractor.ts:531-534', 'These files were discarded because of syntax errors and were not saved: - /src/X.tsx: ... Regenerate ONLY these files, each as one complete <file path="/...">FULL FILE CONTENT</file> block. Do not modify any other file. Check that every bracket, brace, parenthesis and JSX tag is closed before finishing.'],
      ['CF tool-phase done', 'src/lib/agent-capabilities.ts:155', 'The tool phase is complete. Continue the original task using the results above. Output any remaining implementation as complete <file path="/...">content</file> blocks. Do not emit tool calls or DSML; tools are unavailable in this final response.'],
      ['model handoff', 'src/agent.ts:1965', 'You are continuing a project that was previously generated with model "X". Now generating with "Y". Maintain full continuity with existing components, styles, APIs, and conventions. Do NOT rewrite or discard existing working files.'],
      ['project memory', 'src/agent.ts:1939-1952', 'Active Project Architecture & Components: - Existing UI Components: ... - Existing Backend Files: ... - Known Backend API Endpoints: GET /api/items, POST /api/items'],
    ];
    const lines = ['=== REPAIR / RESUME / RETRY INSTRUCTION STRINGS ===', ''];
    for (const [label, where, text] of rows) {
      lines.push(`[${label}]  ${where}`);
      lines.push(`  tokens ~${estimateTokens(text)}  chars=${text.length}`);
    }
    lines.push('');
    lines.push('fix-with-screenshot: NO dedicated instruction string. ChatPanel.tsx:2207-2214');
    lines.push("  setInput('Fix the visual issues shown in my screenshot') + opens the file picker,");
    lines.push('  so it rides the ordinary build/edit prompt path with an image attachment.');
    console.log('\n' + lines.join('\n') + '\n');
  }, 120_000);
});
