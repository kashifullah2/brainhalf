/**
 * BrainHalf Benchmark — Result Writer
 *
 * Accumulates check results per (model, task) pair and writes
 * JSON + Markdown reports to tests/benchmark/results/.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ModelConfig, TaskConfig } from './benchmark.config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.resolve(__dirname, 'results');

// ── Types ────────────────────────────────────────────────────────────────────

export interface CheckResult {
  /** Unique identifier, e.g. "easy-1-check-3" */
  checkId: string;
  /** Human-readable description matching the benchmark spec */
  description: string;
  passed: boolean;
  /** What was actually observed (stringified for easy diffing) */
  actual?: string;
  /** What was expected */
  expected?: string;
  /** If an exception was thrown during the check */
  error?: string;
  durationMs: number;
}

export interface TaskRunResult {
  model: ModelConfig;
  task: TaskConfig;
  build_success: boolean;
  console_errors_on_load: number;
  time_to_ready_seconds: number;
  auto_fix_triggered: boolean;
  auto_fix_resolved: 'true' | 'false' | 'na';
  responsive_pass_desktop: boolean;
  responsive_pass_tablet: boolean;
  responsive_pass_mobile: boolean;
  checks: CheckResult[];
  playwright_checks_passed: string; // "x/y"
  reviewer_notes: string;
  error?: string; // top-level error if build itself failed
}

export interface BenchmarkRun {
  runId: string;
  startedAt: string;
  completedAt?: string;
  base_url: string;
  results: TaskRunResult[];
}

// ── Run state ────────────────────────────────────────────────────────────────

let currentRun: BenchmarkRun | null = null;
let runFilePath = '';

export function initRun(baseUrl: string): BenchmarkRun {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const runId = `benchmark-${ts}`;

  currentRun = {
    runId,
    startedAt: new Date().toISOString(),
    base_url: baseUrl,
    results: [],
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  runFilePath = path.join(RESULTS_DIR, `${runId}.json`);

  // Write empty shell immediately so the file exists even if aborted
  _flushJSON();

  console.log(`[BenchmarkRun] Started ${runId} → ${runFilePath}`);
  return currentRun;
}

export function addResult(result: TaskRunResult): void {
  if (!currentRun) throw new Error('Call initRun() before addResult()');

  // Compute playwright_checks_passed from checks array
  const passed = result.checks.filter((c) => c.passed).length;
  const total = result.checks.length || result.task.totalChecks;
  result.playwright_checks_passed = `${passed}/${total}`;

  currentRun.results.push(result);
  _flushJSON();
}

export function finalizeRun(): void {
  if (!currentRun) return;
  currentRun.completedAt = new Date().toISOString();
  _flushJSON();
  _writeMarkdown();
  console.log(`[BenchmarkRun] Completed. Results: ${runFilePath}`);
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function _flushJSON(): void {
  fs.writeFileSync(runFilePath, JSON.stringify(currentRun, null, 2), 'utf-8');
}

function _writeMarkdown(): void {
  if (!currentRun) return;

  const mdPath = runFilePath.replace('.json', '.md');
  const lines: string[] = [];

  lines.push(`# BrainHalf Benchmark Report`);
  lines.push(`**Run ID**: \`${currentRun.runId}\``);
  lines.push(`**Started**: ${currentRun.startedAt}`);
  lines.push(`**Completed**: ${currentRun.completedAt ?? '(incomplete)'}`);
  lines.push(`**Target**: ${currentRun.base_url}`);
  lines.push('');

  // Group results by task for the cross-model comparison
  const taskIds = [...new Set(currentRun.results.map((r) => r.task.id))];

  for (const taskId of taskIds) {
    const taskResults = currentRun.results.filter((r) => r.task.id === taskId);
    if (taskResults.length === 0) continue;

    const task = taskResults[0].task;
    lines.push(`---`);
    lines.push(`## ${task.tier.toUpperCase()} · ${task.id} — ${task.title}`);
    lines.push('');

    // Summary table
    lines.push(
      '| Model | Build | Console Errors | Time (s) | Checks | AutoFix | Desktop | Tablet | Mobile |'
    );
    lines.push(
      '|-------|-------|----------------|----------|--------|---------|---------|--------|--------|'
    );

    for (const r of taskResults) {
      const build = r.build_success ? '✅' : '❌';
      const af = r.auto_fix_triggered
        ? r.auto_fix_resolved === 'true'
          ? '✅ fixed'
          : '❌ failed'
        : '—';
      lines.push(
        `| ${r.model.label} | ${build} | ${r.console_errors_on_load} | ${r.time_to_ready_seconds} | **${r.playwright_checks_passed}** | ${af} | ${r.responsive_pass_desktop ? '✅' : '❌'} | ${r.responsive_pass_tablet ? '✅' : '❌'} | ${r.responsive_pass_mobile ? '✅' : '❌'} |`
      );
    }
    lines.push('');

    // Per-model failed checks detail
    for (const r of taskResults) {
      const failed = r.checks.filter((c) => !c.passed);
      if (failed.length > 0) {
        lines.push(`### ❌ ${r.model.label} — Failed Checks`);
        lines.push('');
        for (const c of failed) {
          lines.push(`- **${c.checkId}**: ${c.description}`);
          if (c.expected) lines.push(`  - Expected: \`${c.expected}\``);
          if (c.actual) lines.push(`  - Actual: \`${c.actual}\``);
          if (c.error) lines.push(`  - Error: \`${c.error}\``);
        }
        lines.push('');
      }
      if (r.reviewer_notes) {
        lines.push(`### 📝 ${r.model.label} — Reviewer Notes`);
        lines.push(r.reviewer_notes);
        lines.push('');
      }
    }
  }

  // Overall leaderboard
  lines.push('---');
  lines.push('## Overall Leaderboard');
  lines.push('');

  const modelScores: Record<string, { passed: number; total: number; label: string }> = {};
  for (const r of currentRun.results) {
    if (!modelScores[r.model.id]) {
      modelScores[r.model.id] = { passed: 0, total: 0, label: r.model.label };
    }
    const p = r.checks.filter((c) => c.passed).length;
    const t = r.checks.length || r.task.totalChecks;
    modelScores[r.model.id].passed += p;
    modelScores[r.model.id].total += t;
  }

  const sorted = Object.entries(modelScores).sort(
    ([, a], [, b]) => b.passed / b.total - a.passed / a.total
  );

  lines.push('| Rank | Model | Checks Passed | % Score |');
  lines.push('|------|-------|--------------|---------|');
  sorted.forEach(([, score], i) => {
    const pct = score.total > 0 ? ((score.passed / score.total) * 100).toFixed(1) : 'N/A';
    lines.push(`| ${i + 1} | ${score.label} | ${score.passed}/${score.total} | **${pct}%** |`);
  });
  lines.push('');

  fs.writeFileSync(mdPath, lines.join('\n'), 'utf-8');
  console.log(`[BenchmarkRun] Markdown report: ${mdPath}`);
}

// ── Helper: build a default TaskRunResult skeleton ───────────────────────────

export function makeTaskRunResult(model: ModelConfig, task: TaskConfig): TaskRunResult {
  return {
    model,
    task,
    build_success: false,
    console_errors_on_load: 0,
    time_to_ready_seconds: 0,
    auto_fix_triggered: false,
    auto_fix_resolved: 'na',
    responsive_pass_desktop: false,
    responsive_pass_tablet: false,
    responsive_pass_mobile: false,
    checks: [],
    playwright_checks_passed: `0/${task.totalChecks}`,
    reviewer_notes: '',
  };
}

// ── Safe check runner wrapper ─────────────────────────────────────────────────

/**
 * Runs a single check function and returns a CheckResult, swallowing exceptions
 * so one failing check doesn't abort the rest of the suite.
 */
export async function runCheck(
  checkId: string,
  description: string,
  fn: () => Promise<{ passed: boolean; actual?: string; expected?: string }>
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const result = await fn();
    return {
      checkId,
      description,
      passed: result.passed,
      actual: result.actual,
      expected: result.expected,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      checkId,
      description,
      passed: false,
      error: message,
      durationMs: Date.now() - start,
    };
  }
}
