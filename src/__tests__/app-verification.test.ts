import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { runVerificationPlan, verificationPlan, STARTER_VERIFICATION, type VerificationDriver } from '../runtime/verification';

const bookingPlan = {
  version: 1, access: 'private', steps: [
    { type: 'request', name: 'Book appointment', path: '/api/bookings', method: 'POST', body: { day: '2026-10-01' }, status: 201, capture: { booking: '/booking/id' } },
    { type: 'database', name: 'Persist appointment', sql: 'SELECT day FROM bookings WHERE id=?', params: ['{{booking}}'], rows: 1, assertions: [{ pointer: '/0/day', equals: '2026-10-01' }] },
    { type: 'request', name: 'Reject another user', path: '/api/bookings/{{booking}}', as: 'otherUser', status: 404 },
    { type: 'request', name: 'Read appointment', path: '/api/bookings/{{booking}}', status: 200, assertions: [{ pointer: '/booking/day', equals: '2026-10-01' }] },
    { type: 'browser', name: 'Open appointment view', action: 'goto', path: '/bookings/{{booking}}' },
  ],
};
function parse(value: unknown) { return verificationPlan({ 'brainhalf.verify.json': JSON.stringify(value) })!; }
function fixture(persist = true) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE bookings(id TEXT PRIMARY KEY, day TEXT, owner TEXT)');
  const driver: VerificationDriver = {
    assertRunning: vi.fn(async () => {}), browser: vi.fn(async () => {}),
    query: async (sql, params) => db.prepare(sql).all(...params),
    request: vi.fn(async step => {
      if (step.path === '/api/bookings' && step.method === 'POST') {
        if (persist) db.prepare('INSERT INTO bookings VALUES (?,?,?)').run('booking-42', '2026-10-01', 'user');
        return Response.json({ booking: { id: 'booking-42' } }, { status: 201 });
      }
      const row = db.prepare('SELECT id,day FROM bookings WHERE id=? AND owner=?').get(step.path.split('/').pop()!, step.as);
      return row ? Response.json({ booking: row }) : Response.json({ error: 'Not found' }, { status: 404 });
    }),
  };
  return { db, driver };
}
describe('App-specific verification', () => {
  it('executes a custom booking workflow, proving independent SQLite persistence and permission checks', async () => {
    const { db, driver } = fixture();
    try {
      const checks = await runVerificationPlan(parse(bookingPlan), driver);
      expect(checks).toHaveLength(5); expect(checks.every(check => check.passed)).toBe(true);
      expect(driver.browser).toHaveBeenCalledWith(expect.objectContaining({ path: '/bookings/booking-42' }));
      expect(driver.request).toHaveBeenCalledWith(expect.objectContaining({ path: '/api/bookings/booking-42', as: 'otherUser' }));
    } finally { db.close(); }
  });
  it('fails when the API claims success without a real database write', async () => {
    const { db, driver } = fixture(false);
    try {
      const checks = await runVerificationPlan(parse(bookingPlan), driver);
      expect(checks[checks.length - 1]).toMatchObject({ name: 'Persist appointment', passed: false });
      expect(driver.browser).not.toHaveBeenCalled();
      expect(driver.request).toHaveBeenCalledOnce();
    } finally { db.close(); }
  });
  it('rejects a real permission regression and does not continue after it', async () => {
    const { db, driver } = fixture();
    const request = driver.request;
    driver.request = async step => step.as === 'otherUser' ? Response.json({ booking: { id: 'booking-42' } }) : request(step);
    try {
      const checks = await runVerificationPlan(parse(bookingPlan), driver);
      expect(checks[checks.length - 1]).toMatchObject({ name: 'Reject another user', passed: false, detail: 'Expected HTTP 404; received 200.' });
      expect(driver.browser).not.toHaveBeenCalled();
    } finally { db.close(); }
  });
  it.each(['https://outside.test/api/bookings', '//outside.test/api/bookings', '/api/../__brainhalf/open', '/api/\\outside.test', '/api/auth/google/start'])('rejects unsafe or external request path %s', path => {
    const plan = structuredClone(bookingPlan); plan.steps[0].path = path;
    expect(() => parse(plan)).toThrow('Invalid brainhalf.verify.json');
  });
  it.each(['DELETE FROM bookings', 'SELECT * FROM bookings; DROP TABLE bookings', 'PRAGMA database_list', 'SELECT * FROM bookings -- comment'])('rejects SQL outside the read-only assertion contract: %s', sql => {
    const plan = structuredClone(bookingPlan); plan.steps[1].sql = sql;
    expect(() => parse(plan)).toThrow('read-only SELECT');
  });
  it('requires persistence and private-access coverage instead of accepting empty success checks', () => {
    expect(() => parse({ ...bookingPlan, steps: bookingPlan.steps.filter(step => step.type !== 'database') })).toThrow('persisted data');
    expect(() => parse({ ...bookingPlan, steps: bookingPlan.steps.filter(step => step.as !== 'otherUser') })).toThrow('access-denial');
    expect(() => parse({ ...bookingPlan, steps: [bookingPlan.steps[0], ...bookingPlan.steps] })).toThrow('unique');
    expect(() => parse({ ...bookingPlan, hiddenCredentials: 'secret' })).toThrow();
  });
  it('rejects missing variables and inherited properties without running later steps', async () => {
    const { db, driver } = fixture();
    try {
      const missing = structuredClone(bookingPlan); missing.steps[0].path = '/api/bookings/{{unknown}}';
      expect((await runVerificationPlan(parse(missing), driver))[0].passed).toBe(false);
      expect(driver.request).not.toHaveBeenCalled();
      const inherited = structuredClone(bookingPlan); inherited.steps[0].capture = { booking: '/constructor' };
      expect((await runVerificationPlan(parse(inherited), driver))[0]).toMatchObject({ passed: false, detail: 'Missing verification field: /constructor' });
    } finally { db.close(); }
  });
  it('honors cancellation before any requests', async () => {
    const { db, driver } = fixture(); driver.assertRunning = async () => { throw new Error('Stopped'); };
    try {
      await expect(runVerificationPlan(parse(bookingPlan), driver)).rejects.toThrow('Stopped');
      expect(driver.request).not.toHaveBeenCalled();
    } finally { db.close(); }
  });
  it('validates the supplied starter plan and recognizes legacy projects', () => {
    expect(parse(STARTER_VERIFICATION).steps.length).toBeGreaterThan(5);
    expect(verificationPlan({})).toBeNull();
    expect(() => verificationPlan({ 'brainhalf.verify.json': '{broken' })).toThrow('Fix the JSON');
  });
});
