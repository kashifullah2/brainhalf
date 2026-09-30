import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { GenerationJobs, MAX_RESUMES } from '../lib/generation-jobs';
import { AGENT_MIGRATIONS, runMigrations } from '../lib/migrations';

function setup() {
  const database = new DatabaseSync(':memory:');
  const transaction = <Value,>(work: () => Value): Value => {
    database.exec('BEGIN');
    try { const result = work(); database.exec('COMMIT'); return result; }
    catch (error) { database.exec('ROLLBACK'); throw error; }
  };
  runMigrations(AGENT_MIGRATIONS, statement => database.prepare(statement).all(), transaction);
  const jobs = new GenerationJobs((sql, ...params) =>
    database.prepare(sql).all(...params) as Array<Record<string, any>>,
  );
  return { database, jobs };
}

describe('GenerationJobs', () => {
  it('creates and reads back a running job', () => {
    const { database, jobs } = setup();
    try {
      const job = jobs.create({ id: 'job-1', prompt: 'build a shop', model: 'claude' });
      expect(job.status).toBe('running');
      expect(job.completedFiles).toEqual([]);
      expect(job.resumeCount).toBe(0);
      expect(jobs.get('job-1')?.prompt).toBe('build a shop');
      expect(jobs.get('missing')).toBeNull();
    } finally { database.close(); }
  });

  it('records completed files idempotently and only while running', () => {
    const { database, jobs } = setup();
    try {
      jobs.create({ id: 'job-1', prompt: 'p', model: 'm' });
      jobs.markFileComplete('job-1', '/src/App.tsx');
      jobs.markFileComplete('job-1', '/src/App.tsx');
      jobs.markFileComplete('job-1', '/src/main.tsx');
      expect(jobs.get('job-1')?.completedFiles).toEqual(['/src/App.tsx', '/src/main.tsx']);
      jobs.complete('job-1');
      jobs.markFileComplete('job-1', '/src/late.tsx');
      expect(jobs.get('job-1')?.completedFiles).toEqual(['/src/App.tsx', '/src/main.tsx']);
    } finally { database.close(); }
  });

  it('transitions running -> complete / failed / interrupted exactly once', () => {
    const { database, jobs } = setup();
    try {
      jobs.create({ id: 'a', prompt: 'p', model: 'm' });
      jobs.create({ id: 'b', prompt: 'p', model: 'm' });
      jobs.create({ id: 'c', prompt: 'p', model: 'm' });
      jobs.complete('a');
      jobs.fail('b', 'quota exhausted');
      jobs.interrupt('c', 'stream dropped');
      // Second transitions are ignored.
      jobs.fail('a', 'late');
      jobs.complete('b');
      jobs.complete('c');
      expect(jobs.get('a')?.status).toBe('complete');
      expect(jobs.get('b')?.status).toBe('failed');
      expect(jobs.get('b')?.error).toBe('quota exhausted');
      expect(jobs.get('c')?.status).toBe('interrupted');
    } finally { database.close(); }
  });

  it('latestResumable returns only interrupted jobs, never hard failures', () => {
    const { database, jobs } = setup();
    try {
      expect(jobs.latestResumable()).toBeNull();
      jobs.create({ id: 'old', prompt: 'p', model: 'm' });
      jobs.interrupt('old', 'dropped');
      jobs.create({ id: 'new', prompt: 'p', model: 'm' });
      jobs.fail('new', 'quota exhausted');
      // A hard failure is terminal: it is not offered for resume, and the
      // older interrupted job was superseded when the new job was created.
      expect(jobs.latestResumable()).toBeNull();
      expect(jobs.canResume(jobs.get('new')!)).toBe(false);
    } finally { database.close(); }
  });

  it('a fresh generation supersedes older interrupted jobs', () => {
    const { database, jobs } = setup();
    try {
      jobs.create({ id: 'old', prompt: 'p', model: 'm' });
      jobs.interrupt('old', 'dropped');
      jobs.create({ id: 'fresh', prompt: 'p2', model: 'm' });
      expect(jobs.get('old')).toBeNull();
      expect(jobs.latestResumable()).toBeNull();
    } finally { database.close(); }
  });

  it('a resume keeps its parent chain and cumulative files', () => {
    const { database, jobs } = setup();
    try {
      const parent = jobs.create({ id: 'parent', prompt: 'p', model: 'm' });
      jobs.markFileComplete('parent', '/src/a.tsx');
      jobs.interrupt('parent', 'dropped');
      const child = jobs.create({
        id: 'child', prompt: 'p', model: 'm',
        parentJobId: parent.id, resumeCount: 1, initialFiles: jobs.get('parent')!.completedFiles,
      });
      expect(child.parentJobId).toBe('parent');
      expect(child.resumeCount).toBe(1);
      expect(child.completedFiles).toEqual(['/src/a.tsx']);
      // Parent is preserved for the chain; the child is the resumable one.
      expect(jobs.get('parent')?.status).toBe('interrupted');
      jobs.interrupt('child', 'dropped again');
      expect(jobs.latestResumable()?.id).toBe('child');
    } finally { database.close(); }
  });

  it('refuses resume once the chain exhausts MAX_RESUMES', () => {
    const { database, jobs } = setup();
    try {
      jobs.create({ id: 'j', prompt: 'p', model: 'm', resumeCount: MAX_RESUMES });
      jobs.interrupt('j', 'dropped');
      const job = jobs.get('j')!;
      expect(jobs.canResume(job)).toBe(false);
      expect(jobs.latestResumable()).toBeNull();
    } finally { database.close(); }
  });

  it('markOrphanedRunning converts stale running jobs to interrupted', () => {
    const { database, jobs } = setup();
    try {
      jobs.create({ id: 'orphan', prompt: 'p', model: 'm' });
      jobs.create({ id: 'done', prompt: 'p', model: 'm' });
      jobs.complete('done');
      expect(jobs.markOrphanedRunning('evicted')).toBe(1);
      expect(jobs.get('orphan')?.status).toBe('interrupted');
      expect(jobs.get('orphan')?.error).toBe('evicted');
      expect(jobs.get('done')?.status).toBe('complete');
      expect(jobs.latestResumable()?.id).toBe('orphan');
    } finally { database.close(); }
  });

  it('survives malformed completed_files JSON', () => {
    const { database, jobs } = setup();
    try {
      jobs.create({ id: 'j', prompt: 'p', model: 'm' });
      database.prepare(`UPDATE generation_jobs SET completed_files = 'not-json' WHERE id = 'j'`).run();
      expect(jobs.get('j')?.completedFiles).toEqual([]);
    } finally { database.close(); }
  });
});
