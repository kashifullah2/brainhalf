import { z } from 'zod';
import starterVerification from '../lib/starter-verification.json';
import { readStreamJson } from './integrations';
import { RuntimeError, type SourceFiles, type VerificationCheck } from './types';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const json: z.ZodType<Json> = z.lazy(() => z.union([z.null(), z.boolean(), z.number().finite(), z.string(), z.array(json), z.record(z.string(), json)]));
const name = z.string().min(1).max(100);
const variable = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/);
const pointer = z.string().max(300).refine(value => value === '' || value.startsWith('/'), 'Use a JSON pointer such as /item/id.');
const path = z.string().min(1).max(1500).refine(value => {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\s#]/.test(value)) return false;
  try {
    const url = new URL(value, 'https://verification.invalid');
    return url.origin === 'https://verification.invalid' && !url.pathname.startsWith('/__brainhalf/');
  } catch { return false; }
}, 'Use an app-relative path.');
const assertion = z.object({ pointer, equals: json }).strict();
const requestStep = z.object({
  type: z.literal('request'), name, path: path.refine(value => value.startsWith('/api/') && !value.startsWith('/api/auth/google/'), 'Use a local API route; Google consent is validated separately.'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  as: z.enum(['user', 'otherUser', 'anonymous']).default('user'),
  body: json.optional(), status: z.number().int().min(200).max(599),
  assertions: z.array(assertion).max(20).default([]),
  capture: z.record(variable, pointer).default({}),
}).strict().refine(step => step.method !== 'GET' || step.body === undefined, 'GET requests cannot contain a body.');
const databaseStep = z.object({
  type: z.literal('database'), name,
  sql: z.string().min(1).max(4000).refine(value => /^\s*SELECT\b/i.test(value) && !/;|--|\/\*|\b(?:PRAGMA|ATTACH|DETACH|INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b/i.test(value), 'Database assertions must use one read-only SELECT statement.'),
  params: z.array(json).max(30).default([]), rows: z.number().int().min(0).max(100),
  assertions: z.array(assertion).max(20).default([]),
}).strict();
const browserStep = z.object({
  type: z.literal('browser'), name,
  action: z.enum(['goto', 'click', 'fill', 'expectVisible', 'expectText']),
  path: path.optional(), selector: z.string().min(1).max(500).optional(), value: z.string().max(2000).optional(),
}).strict().superRefine((step, ctx) => {
  if (step.action === 'goto' && !step.path) ctx.addIssue({ code: 'custom', message: 'Navigation needs a path.' });
  if (step.action !== 'goto' && !step.selector) ctx.addIssue({ code: 'custom', message: 'Browser actions need a selector.' });
  if (['fill', 'expectText'].includes(step.action) && step.value === undefined) ctx.addIssue({ code: 'custom', message: 'This browser action needs a value.' });
});
const schema = z.object({
  version: z.literal(1), access: z.enum(['private', 'public']),
  steps: z.array(z.union([requestStep, databaseStep, browserStep])).min(3).max(40),
}).strict().superRefine((plan, ctx) => {
  if (new Set(plan.steps.map(step => step.name)).size !== plan.steps.length) ctx.addIssue({ code: 'custom', message: 'Check names must be unique.' });
  if (!plan.steps.some(step => step.type === 'request' && step.method !== 'GET' && step.status < 300)) ctx.addIssue({ code: 'custom', message: 'Include a successful API write.' });
  if (!plan.steps.some(step => step.type === 'database' && step.rows > 0 && step.assertions.length)) ctx.addIssue({ code: 'custom', message: 'Include a direct database assertion of persisted data.' });
  if (plan.access === 'private' && !plan.steps.some(step => step.type === 'request' && step.as !== 'user' && [401, 403, 404].includes(step.status))) ctx.addIssue({ code: 'custom', message: 'Private apps need an anonymous or second-user access-denial check.' });
});
export type VerificationPlan = z.infer<typeof schema>;
export type BrowserVerificationStep = z.infer<typeof browserStep>;
export type VerificationRequest = Pick<z.infer<typeof requestStep>, 'path' | 'method' | 'as' | 'body'>;
export interface VerificationDriver {
  request(step: VerificationRequest): Promise<Response>;
  query(sql: string, params: (string | number | null)[]): Promise<Record<string, unknown>[]>;
  browser(step: BrowserVerificationStep): Promise<void>;
  assertRunning(): Promise<void>;
}

export function verificationPlan(files: SourceFiles): VerificationPlan | null {
  const raw = files['brainhalf.verify.json'] ?? files['/brainhalf.verify.json'];
  if (raw === undefined) return null;
  if (new TextEncoder().encode(raw).length > 64_000) throw new RuntimeError('brainhalf.verify.json exceeds 64 KB.');
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new RuntimeError('Fix the JSON in brainhalf.verify.json before verifying.'); }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new RuntimeError(`Invalid brainhalf.verify.json: ${result.error.issues.slice(0, 3).map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  return result.data;
}

function atPointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return value;
  for (const part of pointer.slice(1).split('/').map(item => item.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (['__proto__', 'prototype', 'constructor'].includes(part) || !value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) throw new RuntimeError(`Missing verification field: ${pointer}`);
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
function substitute(value: Json, variables: Map<string, Json>): Json {
  if (typeof value === 'string') {
    const exact = value.match(/^\{\{([A-Za-z][A-Za-z0-9_]*)\}\}$/);
    const get = (key: string) => { if (!variables.has(key)) throw new RuntimeError(`Verification variable ${key} has not been captured.`); return variables.get(key)!; };
    if (exact) return get(exact[1]);
    return value.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_, key: string) => {
      const result = get(key);
      if (typeof result === 'object') throw new RuntimeError('Only scalar values can be inserted into verification text.');
      return String(result);
    });
  }
  if (Array.isArray(value)) return value.map(item => substitute(item, variables));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, variables)]));
  return value;
}
function resolvedPath(value: string, variables: Map<string, Json>): string {
  const encoded = new Map<string, Json>([...variables].map(([key, item]) => {
    if (typeof item === 'object') return [key, item] as const;
    return [key, encodeURIComponent(String(item))] as const;
  }));
  const result = substitute(value, encoded);
  if (typeof result !== 'string' || !path.safeParse(result).success) throw new RuntimeError('Verification path is invalid.');
  return result;
}
function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left); const b = Object.keys(right);
  return a.length === b.length && a.every(key => Object.prototype.hasOwnProperty.call(right, key) && equal((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

/** Executes declared checks against the disposable release only. No generated JavaScript is evaluated here. */
export async function runVerificationPlan(plan: VerificationPlan, driver: VerificationDriver): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = []; const variables = new Map<string, Json>();
  for (const step of plan.steps) {
    await driver.assertRunning();
    try {
      let actual: unknown;
      if (step.type === 'request') {
        const response = await driver.request({ ...step, path: resolvedPath(step.path, variables), body: step.body === undefined ? undefined : substitute(step.body, variables) });
        if (response.status !== step.status) { await response.body?.cancel(); throw new RuntimeError(`Expected HTTP ${step.status}; received ${response.status}.`); }
        if (step.assertions.length || Object.keys(step.capture).length) actual = await readStreamJson(response.body, 64_000);
        else await response.body?.cancel();
        for (const [key, pointer] of Object.entries(step.capture)) {
          if (variables.has(key)) throw new RuntimeError(`Verification variable ${key} was already captured.`);
          const value = json.parse(atPointer(actual, pointer));
          variables.set(key, value);
        }
      } else if (step.type === 'database') {
        const params = step.params.map(value => {
          const result = substitute(value, variables);
          if (result !== null && typeof result !== 'string' && typeof result !== 'number') throw new RuntimeError('Database parameters must be text, numbers, or null.');
          return result;
        });
        actual = await driver.query(`SELECT * FROM (${step.sql}) LIMIT 101`, params);
        if (!Array.isArray(actual) || actual.length !== step.rows) throw new RuntimeError(`Expected ${step.rows} database rows; received ${Array.isArray(actual) ? actual.length : 'invalid data'}.`);
      } else {
        const value = step.value === undefined ? undefined : substitute(step.value, variables);
        if (value !== undefined && typeof value !== 'string') throw new RuntimeError('Browser values must be text.');
        await driver.browser({ ...step, path: step.path ? resolvedPath(step.path, variables) : undefined, value });
      }
      if (step.type !== 'browser') for (const assertion of step.assertions) {
        if (!equal(atPointer(actual, assertion.pointer), substitute(assertion.equals, variables))) throw new RuntimeError(`Value assertion failed at ${assertion.pointer || '/'}.`);
      }
      checks.push({ name: step.name, passed: true, detail: step.type === 'database' ? 'Checked directly in disposable D1.' : step.type === 'request' ? `Real app API returned expected HTTP ${step.status}.` : 'Browser interaction matched the expected result.' });
    } catch (error) {
      checks.push({ name: step.name, passed: false, detail: error instanceof RuntimeError ? error.message : 'The app check failed. Inspect the test definition and runtime logs.' });
      break;
    }
  }
  await driver.assertRunning();
  return checks;
}

export const STARTER_VERIFICATION: VerificationPlan = schema.parse(starterVerification);
