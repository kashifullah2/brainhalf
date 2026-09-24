import { describe, expect, it } from 'vitest';
import { ProductOutcomes, type OutcomeEvent } from '../lib/product-outcomes';
import { sqliteStorage } from './helpers/storage';

const day = 86_400_000;
const start = Date.UTC(2026, 8, 23);
const revision = 'a'.repeat(64);
function setup() {
  const ledger = new ProductOutcomes(sqliteStorage());
  const add = (kind: OutcomeEvent['kind'], id = 'first', extra: Partial<OutcomeEvent> = {}) => ledger.record({ id, ownerId: 'alice', projectId: 'app', kind, at: start + 1000, ...extra }, start + day);
  return { ledger, add };
}
describe('first-party product outcomes', () => {
  it('does not count completed responses or an unrelated verified revision as working apps', () => {
    const { ledger, add } = setup();
    add('generation_started'); add('generation_completed', 'first', { revision });
    add('verification_passed', 'verify', { revision: 'b'.repeat(64), at: start + 2000 });
    expect(ledger.report('alice').workingAppsPerGeneration).toBe(0);
    add('verification_passed', 'correct', { revision, at: start + 3000 });
    add('verification_passed', 'correct', { revision, at: start + 3000 });
    expect(ledger.report('alice')).toMatchObject({ generations: 1, verifiedWorkingGenerations: 1, workingAppsPerGeneration: 1 });
  });
  it('keeps publishing attempts, failure and activation distinct and idempotent', () => {
    const { ledger, add } = setup();
    add('publish_started'); add('publish_started'); add('publish_failed');
    add('publish_started', 'second'); add('publish_passed', 'second'); add('publish_passed', 'second');
    expect(ledger.report('alice')).toMatchObject({ publishAttempts: 2, published: 1, failedPublishes: 1, publishingSuccessRate: 0.5 });
    expect(ledger.report('bob')).toMatchObject({ generations: 0, publishingSuccessRate: null, medianTimeToFirstLiveMs: null });
  });
  it('measures the first live app from first observed workspace activity, not repeat publishing', () => {
    const { ledger, add } = setup(); ledger.activity('alice', start);
    add('publish_passed', 'first', { at: start + 5000 }); add('publish_passed', 'second', { at: start + 9000 });
    ledger.activity('bob', start);
    add('publish_passed', 'third', { ownerId: 'bob', at: start + 7000 });
    expect(ledger.report().medianTimeToFirstLiveMs).toBe(6000);
    expect(ledger.report('alice').medianTimeToFirstLiveMs).toBe(5000);
  });
  it('waits for the complete week-one window before including a cohort', () => {
    const { ledger } = setup(); ledger.activity('alice', start); ledger.activity('bob', start);
    ledger.activity('alice', start + 7 * day); ledger.activity('bob', start + 14 * day);
    expect(ledger.report(undefined, start + 13 * day).weekOneRetention).toBeNull();
    expect(ledger.report(undefined, start + 14 * day)).toMatchObject({ matureWeekOneAccounts: 2, returnedWeekOneAccounts: 1, weekOneRetention: 0.5 });
  });
  it('does not credit another owner, project, or earlier verification', () => {
    const { ledger, add } = setup(); add('generation_started'); add('generation_completed', 'first', { revision });
    add('verification_passed', 'one', { ownerId: 'bob', revision });
    add('verification_passed', 'two', { projectId: 'other', revision });
    add('verification_passed', 'three', { revision, at: start });
    expect(ledger.report('alice').verifiedWorkingGenerations).toBe(0);
  });
  it('rejects malformed fields and does not store arbitrary event payloads', () => {
    const { ledger, add } = setup();
    expect(() => add('publish_passed', 'bad id')).toThrow('Invalid');
    expect(() => add('publish_passed', 'first', { at: Infinity })).toThrow('Invalid');
    expect(() => add('publish_passed', 'first', { revision: 'source code' })).toThrow('Invalid');
    expect(ledger.report('alice').published).toBe(0);
  });
});
