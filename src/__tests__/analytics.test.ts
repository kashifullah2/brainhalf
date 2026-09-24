import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ token: vi.fn(), scope: vi.fn(), on: vi.fn() }));
vi.mock('../lib/auth-client', () => ({ getToken: mocks.token }));
vi.mock('../lib/project-store', () => ({ getProjectStorageScope: mocks.scope }));
vi.mock('../lib/events', () => ({ appEvents: { on: mocks.on } }));

let browser: any;
let scripts: any[];
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.token.mockReturnValue(null);
  mocks.scope.mockReturnValue({ accountId: null });
  scripts = [];
  browser = { location: { href: 'https://brainhalf.com/?utm_source=example#start-building' }, addEventListener: vi.fn() };
  browser.self = browser.top = browser;
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', {
    referrer: 'https://example.com/private/project?token=secret',
    createElement: () => ({}),
    head: { appendChild: (script: unknown) => scripts.push(script) },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('loads the supplied Google tag once and strips private URL context', async () => {
  const { initializeAnalytics } = await import('../lib/analytics');
  initializeAnalytics();
  initializeAnalytics();
  expect(scripts).toEqual([{ async: true, src: 'https://www.googletagmanager.com/gtag/js?id=G-RRR516MXP2' }]);
  const commands = browser.dataLayer.map((args: IArguments) => Array.from(args));
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(['config', 'G-RRR516MXP2', expect.objectContaining({
    page_location: 'https://brainhalf.com/', page_referrer: 'https://example.com',
    allow_google_signals: false, allow_ad_personalization_signals: false,
  })]);
  expect(JSON.stringify(commands)).not.toMatch(/secret|utm_source|start-building/);
});

it.each([
  'http://localhost:5173/', 'https://staging.example.com/',
  'https://brainhalf.com/?project=private', 'https://brainhalf.com/?google=complete',
  'https://brainhalf.com/?token=secret', 'https://brainhalf.com/?_uid=user',
  'https://brainhalf.com/preview/project', 'https://brainhalf.com/missing-page',
])('does not collect from %s', async url => {
  browser.location.href = url;
  (await import('../lib/analytics')).initializeAnalytics();
  expect(scripts).toHaveLength(0);
  expect(browser.dataLayer).toBeUndefined();
});

it('does not load inside frames or existing authenticated sessions', async () => {
  const { initializeAnalytics } = await import('../lib/analytics');
  browser.self = {};
  initializeAnalytics();
  browser.self = browser;
  mocks.token.mockReturnValue('session');
  initializeAnalytics();
  expect(scripts).toHaveLength(0);
});

it('stops collection as soon as an account is attached or another tab signs in', async () => {
  (await import('../lib/analytics')).initializeAnalytics();
  const accountChanged = mocks.on.mock.calls[0][1];
  accountChanged();
  expect(browser['ga-disable-G-RRR516MXP2']).toBeUndefined();
  mocks.scope.mockReturnValue({ accountId: 'signed-in-user' });
  accountChanged();
  expect(browser['ga-disable-G-RRR516MXP2']).toBe(true);
  browser['ga-disable-G-RRR516MXP2'] = false;
  mocks.token.mockReturnValue('session');
  browser.addEventListener.mock.calls[0][1]();
  expect(browser['ga-disable-G-RRR516MXP2']).toBe(true);
});
