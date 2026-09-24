export function createTenantRequest(request: Request, pathname: string): Request {
  const url = new URL(request.url);
  url.pathname = pathname;
  for (const parameter of ['token', 'ticket', '_uid', '_sid']) url.searchParams.delete(parameter);

  const forwarded = new Request(url, request);
  for (const header of ['authorization', 'cookie', 'x-auth-user-id', 'proxy-authorization', 'referer']) {
    forwarded.headers.delete(header);
  }
  return forwarded;
}
