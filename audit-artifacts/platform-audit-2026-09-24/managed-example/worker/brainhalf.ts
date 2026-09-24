/** Server-only managed email. Never expose these bindings through an API response. */
export interface BrainHalfServices { BRAINHALF_SERVICES?: Fetcher; BRAINHALF_SERVICE_TOKEN?: string }
export async function sendAppEmail(env: BrainHalfServices, event: { userId: string; template: 'welcome' | 'order_receipt'; idempotencyKey: string; variables?: { orderId?: string; amount?: string; details?: string } }): Promise<{ id: string; status: string }> {
  if (!env.BRAINHALF_SERVICES || !env.BRAINHALF_SERVICE_TOKEN) throw new Error('Managed email is unavailable. Create a new managed release or configure email for your standalone deployment.');
  const response = await env.BRAINHALF_SERVICES.fetch(new Request('https://services/email', { method: 'POST', headers: { Authorization: 'Bearer ' + env.BRAINHALF_SERVICE_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(event) }));
  const data = await response.json() as { id: string; status: string; error?: string };
  if (!response.ok) throw new Error(data.error || 'Email could not be queued.');
  return { id: data.id, status: data.status };
}
