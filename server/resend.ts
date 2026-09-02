// ---------------------------------------------------------------------------
// Resend API Mail Client for Cloudflare Workers & Pages Functions.
// ---------------------------------------------------------------------------

export interface SendResendEmailOptions {
  /** Resend API Key (re_...) */
  apiKey: string;
  /** Sender email address e.g. "BrainHalf <noreply@yourdomain.com>" */
  from?: string;
  /** Destination email address(es) */
  to: string | string[];
  /** Optional Reply-To address (e.g. contact form visitor's email) */
  replyTo?: string;
  /** Email subject line */
  subject: string;
  /** HTML content body */
  html: string;
  /** Plain text fallback */
  text?: string;
}

export interface SendResendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * Dispatches an email using the Resend REST API (https://api.resend.com/emails).
 * Compatible with standard fetch() in Cloudflare Workers and Node.js environments.
 */
export async function sendResendEmail(
  options: SendResendEmailOptions,
): Promise<SendResendEmailResult> {
  const {
    apiKey,
    from = 'BrainHalf <noreply@brainhalf.com>',
    to,
    replyTo,
    subject,
    html,
    text,
  } = options;

  if (!apiKey) {
    return { ok: false, error: 'Resend API key is missing.' };
  }

  try {
    const payload: Record<string, unknown> = {
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    };

    if (replyTo) payload.reply_to = replyTo;
    if (text) payload.text = text;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as { id?: string; message?: string; name?: string };

    if (!res.ok) {
      const errorMsg = data.message || data.name || `HTTP status ${res.status}`;
      console.error('[resend] API request failed:', res.status, errorMsg);
      return { ok: false, error: errorMsg };
    }

    return { ok: true, id: data.id };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Network failure sending email';
    console.error('[resend] Exception during send:', message);
    return { ok: false, error: message };
  }
}
