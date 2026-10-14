export function apiOrigin(): string {
  if (typeof location === 'undefined') return '';
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return '';
  const raw = (import.meta.env.VITE_BACKEND_HOST || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  const proto = location.protocol === 'https:' ? 'https://' : 'http://';
  return `${proto}${raw.replace(/\/+$/, '')}`;
}

export function wsOrigin(): string {
  if (typeof location === 'undefined') return 'ws://localhost:8787';
  const isHttps = location.protocol === 'https:';
  const raw = ['localhost', '127.0.0.1'].includes(location.hostname)
    ? (import.meta.env.VITE_BACKEND_HOST || '').trim()
    : '';
  if (!raw) {
    return `${isHttps ? 'wss:' : 'ws:'}//${location.host}`;
  }
  if (/^wss?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(/^http/i, 'ws').replace(/\/+$/, '');
  }
  return `${isHttps ? 'wss:' : 'ws:'}//${raw.replace(/\/+$/, '')}`;
}
