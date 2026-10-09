import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from '../lib/allowed-origins';

const LOCALHOST = 'http://localhost:5173';
const PRODUCTION = 'https://brainhalf.com';

describe('IS_DEV flag — must never be truthy for non-"true" strings', () => {
  it('"false" does not unlock localhost origins', () => {
    expect(isAllowedOrigin(LOCALHOST, { IS_DEV: 'false' })).toBe(false);
  });
  it('"" does not unlock localhost origins', () => {
    expect(isAllowedOrigin(LOCALHOST, { IS_DEV: '' })).toBe(false);
  });
  it('undefined does not unlock localhost origins', () => {
    expect(isAllowedOrigin(LOCALHOST, { IS_DEV: undefined })).toBe(false);
  });
  it('boolean false does not unlock localhost origins', () => {
    expect(isAllowedOrigin(LOCALHOST, { IS_DEV: false })).toBe(false);
  });
  it('"true" unlocks localhost origins', () => {
    expect(isAllowedOrigin(LOCALHOST, { IS_DEV: 'true' })).toBe(true);
  });
  it('boolean true unlocks localhost origins', () => {
    expect(isAllowedOrigin(LOCALHOST, { IS_DEV: true })).toBe(true);
  });
  it('production origin is always allowed regardless of IS_DEV', () => {
    expect(isAllowedOrigin(PRODUCTION, { IS_DEV: 'false' })).toBe(true);
    expect(isAllowedOrigin(PRODUCTION, { IS_DEV: undefined })).toBe(true);
    expect(isAllowedOrigin(PRODUCTION, { IS_DEV: 'true' })).toBe(true);
  });
});
