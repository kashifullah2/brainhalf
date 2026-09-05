import { describe, expect, it } from 'vitest';

import { adminEmails, isAdminEmail } from './admin';

describe('isAdminEmail', () => {
  const env = { ADMIN_EMAILS: 'owner@brainhalf.com, Admin@BrainHalf.com' };

  it('matches a configured address exactly, ignoring case and padding', () => {
    expect(isAdminEmail(env, 'owner@brainhalf.com')).toBe(true);
    expect(isAdminEmail(env, '  OWNER@BrainHalf.COM ')).toBe(true);
    expect(isAdminEmail(env, 'admin@brainhalf.com')).toBe(true);
  });

  it('does not match on substrings, which is how the previous check was bypassed', () => {
    // Every one of these satisfied `user.email.includes('kashif')` or
    // `user.email.includes('owner@brainhalf.com')`-style containment.
    expect(isAdminEmail(env, 'owner@brainhalf.com.attacker.example')).toBe(false);
    expect(isAdminEmail(env, 'notowner@brainhalf.com')).toBe(false);
    expect(isAdminEmail(env, 'owner@brainhalf.co')).toBe(false);
    expect(isAdminEmail({ ADMIN_EMAILS: 'kashif' }, 'kashif@attacker.example')).toBe(false);
  });

  it('ignores allowlist entries that are not addresses', () => {
    // A bare word could only ever have worked as a substring rule.
    expect(adminEmails({ ADMIN_EMAILS: 'kashif,kashifullah,real@example.com' })).toEqual([
      'real@example.com',
    ]);
  });

  it('treats a missing or blank email as not an administrator', () => {
    expect(isAdminEmail(env, null)).toBe(false);
    expect(isAdminEmail(env, undefined)).toBe(false);
    expect(isAdminEmail(env, '   ')).toBe(false);
  });

  it('falls back to the built-in owner address when ADMIN_EMAILS is unset', () => {
    expect(isAdminEmail({}, 'kashifullah919@gmail.com')).toBe(true);
    expect(isAdminEmail({}, 'someone@example.com')).toBe(false);
  });

  it('an empty ADMIN_EMAILS is not an empty allowlist, it is the default', () => {
    // Guards against a deployment that sets the variable to "" locking the owner
    // out, which is a support call rather than a security improvement.
    expect(isAdminEmail({ ADMIN_EMAILS: '   ' }, 'kashifullah919@gmail.com')).toBe(true);
  });
});
