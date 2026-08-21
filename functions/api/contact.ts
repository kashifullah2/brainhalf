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

interface Body {
  name?: unknown;
  email?: unknown;
  subject?: unknown;
  message?: unknown;
}

const MAX_NAME = 100;
const MAX_SUBJECT = 200;
const MAX_MESSAGE = 5_000;

const SUPPORT_INBOX = 'support@brainhalf.com';
const SENDER = { email: 'noreply@brainhalf.com', name: 'BrainHalf Contact Form' };

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

  if (!env.EMAIL) {
    // A missing binding is our problem, not the sender's: log the specifics and
    // keep the response generic.
    console.error('[api/contact] EMAIL binding is not configured.');
    return fail('The contact form is unavailable right now.', 503);
  }

  try {
    await env.EMAIL.send({
      to: SUPPORT_INBOX,
      // The envelope sender stays a domain we control; the visitor's address
      // travels as Reply-To, so replying still reaches them.
      from: SENDER,
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
  } catch (error) {
    console.error('[api/contact] send failed:', error);
    return fail('Could not send your message. Please try again.', 502);
  }

  return json({ success: true }, 200);
};
