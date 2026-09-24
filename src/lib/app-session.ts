export function getAppSessionToken(headers: Headers): string | null {
  return headers.get('authorization')?.match(/^Bearer (bh_token_[A-Za-z0-9+/_=-]+)$/)?.[1] || null;
}
