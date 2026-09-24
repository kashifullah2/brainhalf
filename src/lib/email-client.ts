export async function submitEmailRequest(path: string, body: Record<string, string>): Promise<{ message?: string }> {
  const response = await fetch(`/api/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || 'The request could not be completed. Please try again.');
  return result || {};
}
