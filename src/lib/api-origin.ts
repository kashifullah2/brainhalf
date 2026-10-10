export function apiOrigin(): string {
  if (typeof location === 'undefined') return '';
  return ['localhost', '127.0.0.1'].includes(location.hostname)
    ? import.meta.env.VITE_BACKEND_HOST || ''
    : '';
}
