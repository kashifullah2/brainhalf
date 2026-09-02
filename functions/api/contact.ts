// ---------------------------------------------------------------------------
// Contact form relay.
//
// This endpoint is unauthenticated by necessity, so everything it receives is
// hostile until proven otherwise:
//
//  - Every field is HTML-escaped before it reaches the email body. The previous
//    version interpolated them raw, so an anonymous caller could inject
//    arbitrary markup and links into mail delivered to the support inbox.
//  - CR/LF is stripped from anything that lands in a mail header, which is what
//    stops `subject` from being used to inject headers of its own.
//  - Upstream failure reasons are logged, never returned. The old handler sent
//    `error.message` to the caller.
// ---------------------------------------------------------------------------

import {
  escapeHtml,
  fail,
  isPlausibleEmail,
  json,
  normalizeEmail,
  readJson,
  type AppEnv,
} from '../../server/http';
import { RULES, enforceRateLimit, ipIdentity } from '../../server/rate-limit';
import { sendResendEmail } from '../../server/resend';

interface Body {
  name?: unknown;
  email?: unknown;
  subject?: unknown;
  message?: unknown;
}

const MAX_NAME = 100;
const MAX_SUBJECT = 200;
const MAX_MESSAGE = 5_000;

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** For values that end up in a mail header, where a newline starts a new header. */
function cleanHeaderText(value: unknown, max: number): string {
  return cleanText(value, max).split('\r').join(' ').split('\n').join(' ');
}

export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env }) => {
  // Unauthenticated and it sends mail, so without a limit it is a spam relay.
  const limited = await enforceRateLimit(
    env,
    'contact',
    ipIdentity(request),
    RULES.contact,
  );
  if (limited) return limited;

  const body = await readJson<Body>(request);
  if (!body) return fail('Request body must be valid JSON.', 400);

  const name = cleanText(body.name, MAX_NAME);
  const email = normalizeEmail(body.email);
  const subject = cleanHeaderText(body.subject, MAX_SUBJECT);
  const message = cleanText(body.message, MAX_MESSAGE);

  if (!name || !subject || !message) {
    return fail('Name, subject, and message are required.', 400);
  }
  if (!isPlausibleEmail(email)) {
    return fail('Enter a valid email address.', 400);
  }

  const supportInbox = env.SUPPORT_EMAIL || 'support@brainhalf.com';
  const senderEmail = env.RESEND_FROM_EMAIL || 'BrainHalf Contact <contact@brainhalf.com>';

  const origin = new URL(request.url).origin;

  // Primary path: Send via Resend API
  if (env.RESEND_API_KEY) {
    const result = await sendResendEmail({
      apiKey: env.RESEND_API_KEY,
      from: senderEmail,
      to: supportInbox,
      replyTo: email,
      subject: `[Contact Form] ${subject}`,
      text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
      html: `
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; padding: 40px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <tr>
            <td align="center">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 580px;">
                <!-- Logo Header -->
                <tr>
                  <td align="center" style="padding-bottom: 28px;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td valign="middle" style="padding-right: 10px;">
                          <img src="${origin}/apple-touch-icon.png" alt="BrainHalf Logo" width="42" height="42" style="display: block; border-radius: 10px; border: 0; outline: none;" />
                        </td>
                        <td valign="middle" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 26px; line-height: 1;">
                          <span style="font-weight: 600; color: #0f172a;">brain</span><span style="font-weight: 800; color: #4f46e5;">half</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Main Card -->
                <tr>
                  <td style="background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 36px 32px; box-shadow: 0 10px 15px -3px rgba(15, 23, 42, 0.04);">
                    <div style="border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; margin-bottom: 20px;">
                      <h1 style="margin: 0 0 6px 0; font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.3px;">
                        New Contact Form Inquiry
                      </h1>
                      <p style="margin: 0; font-size: 13px; color: #64748b;">Submitted via BrainHalf Contact Page</p>
                    </div>
                    
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 20px; font-size: 14px;">
                      <tr>
                        <td style="padding: 6px 0; color: #64748b; width: 80px;" valign="top"><strong>From:</strong></td>
                        <td style="padding: 6px 0; color: #0f172a;" valign="top">
                          <strong>${escapeHtml(name)}</strong> &lt;<a href="mailto:${escapeHtml(email)}" style="color: #4f46e5; text-decoration: none;">${escapeHtml(email)}</a>&gt;
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; color: #64748b;" valign="top"><strong>Subject:</strong></td>
                        <td style="padding: 6px 0; color: #0f172a; font-weight: 600;" valign="top">${escapeHtml(subject)}</td>
                      </tr>
                    </table>
                    
                    <!-- Message Body Box -->
                    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; font-size: 14.5px; line-height: 1.6; color: #334155; white-space: pre-wrap;">${escapeHtml(message)}</div>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td align="center" style="padding-top: 24px; font-size: 12px; color: #94a3b8;">
                    BrainHalf Support System &bull; &copy; BrainHalf
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `,
    });

    if (!result.ok) {
      console.error('[api/contact] Resend failed:', result.error);
      return fail('Could not send your message. Please try again.', 502);
    }

    return json({ success: true }, 200);
  }

  // Fallback path: Cloudflare Worker Email Service
  if (env.EMAIL) {
    try {
      await env.EMAIL.send({
        to: supportInbox,
        from: { email: 'noreply@brainhalf.com', name: 'BrainHalf Contact Form' },
        replyTo: email,
        subject: `[Contact Form] ${subject}`,
        text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
        html:
          `<p><strong>Name:</strong> ${escapeHtml(name)}</p>` +
          `<p><strong>Email:</strong> ${escapeHtml(email)}</p>` +
          `<p><strong>Subject:</strong> ${escapeHtml(subject)}</p>` +
          `<p><strong>Message:</strong></p>` +
          `<p>${escapeHtml(message).split('\n').join('<br>')}</p>`,
      });
      return json({ success: true }, 200);
    } catch (error) {
      console.error('[api/contact] Cloudflare email send failed:', error);
      return fail('Could not send your message. Please try again.', 502);
    }
  }

  console.warn('[api/contact] No RESEND_API_KEY or EMAIL binding configured.');
  return fail('The contact form service is not configured.', 503);
};
