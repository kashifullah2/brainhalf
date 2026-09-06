import {
  isPlausibleEmail,
  json,
  normalizeEmail,
  readJson,
  type AppEnv,
} from '../../../server/http';
import { randomToken, sha256Hex } from '../../../server/crypto';
import {
  RULES,
  enforceRateLimit,
  ipIdentity,
} from '../../../server/rate-limit';
import { sendResendEmail } from '../../../server/resend';

interface Body {
  email?: unknown;
}

const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

function expiryIso(seconds: number): string {
  return new Date(Date.now() + seconds * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
}

/**
 * Always answers 200 with the same body, whether or not the address exists.
 * Anything else turns this endpoint into an account-enumeration oracle.
 */
export const onRequestPost: PagesFunction<AppEnv> = async ({ request, env }) => {
  // Throttled per IP, never per address, so a 429 still discloses nothing about
  // which accounts exist -- the same property the 200-always response protects.
  const limited = await enforceRateLimit(
    env,
    'auth/password-reset',
    ipIdentity(request),
    RULES.passwordReset,
  );
  if (limited) return limited;

  const body = await readJson<Body>(request);
  const email = normalizeEmail(body?.email);

  const acknowledged = json(
    {
      ok: true,
      message:
        'If an account exists for that address, a reset link is on its way.',
    },
    200,
  );

  if (!isPlausibleEmail(email)) return acknowledged;

  const user = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`)
    .bind(email)
    .first<{ id: string }>();

  if (!user) return acknowledged;

  const token = randomToken(32);

  try {
    // Invalidate any earlier outstanding tokens for this user.
    await env.DB.prepare(
      `UPDATE password_reset_tokens SET used_at = datetime('now')
        WHERE user_id = ? AND used_at IS NULL`,
    )
      .bind(user.id)
      .run();

    await env.DB.prepare(
      `INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
       VALUES (?, ?, ?)`,
    )
      .bind(await sha256Hex(token), user.id, expiryIso(TOKEN_TTL_SECONDS))
      .run();
  } catch (error) {
    console.error('[auth/password-reset] could not store token:', error);
    return acknowledged;
  }

  const origin = new URL(request.url).origin;
  const resetUrl = `${origin}/reset-password?token=${token}`;
  const sender = env.RESEND_FROM_EMAIL || 'BrainHalf Security <noreply@brainhalf.com>';

  // Primary path: Send via Resend API
  if (env.RESEND_API_KEY) {
    const result = await sendResendEmail({
      apiKey: env.RESEND_API_KEY,
      from: sender,
      to: email,
      subject: 'Reset your BrainHalf password',
      text:
        `Someone requested to reset the password for your BrainHalf account.\n\n` +
        `Click the link below to set a new password:\n${resetUrl}\n\n` +
        `This link will expire in 1 hour. If you did not make this request, you can safely ignore this email.`,
      html: `
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; padding: 40px 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <tr>
            <td align="center">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 540px;">
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
                    <h1 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #0f172a; text-align: center; letter-spacing: -0.3px;">
                      Reset Your Password
                    </h1>
                    <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #475569; text-align: center;">
                      We received a request to reset your BrainHalf account password. Click the button below to set a new password:
                    </p>
                    
                    <!-- Button CTA -->
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 28px;">
                      <tr>
                        <td align="center">
                          <a href="${resetUrl}" target="_blank" style="background-color: #4f46e5; color: #ffffff; display: inline-block; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 10px; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.25);">
                            Reset Password
                          </a>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Notice Box -->
                    <div style="background-color: #f1f5f9; border-radius: 10px; padding: 16px; text-align: center;">
                      <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #64748b;">
                        This link is valid for <strong>1 hour</strong>. If you did not request a password reset, you can safely ignore this email.
                      </p>
                    </div>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td align="center" style="padding-top: 24px; font-size: 12px; color: #94a3b8;">
                    &copy; ${new Date().getFullYear()} BrainHalf &bull; AI Document Processing Platform
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `,
    });

    if (!result.ok) {
      console.error('[auth/password-reset] Resend dispatch failed:', result.error);
    }
    return acknowledged;
  }

  // Fallback: legacy EmailJS.
  //
  // Server-only names, with no VITE_ fallback. Accepting `VITE_EMAILJS_SERVICE_ID`
  // / `VITE_EMAILJS_PWD_TEMPLATE_ID` / `VITE_EMAILJS_PUBLIC_KEY` here was an
  // invitation to configure exactly the thing this endpoint exists to avoid: a
  // VITE_ variable is substituted into the published JavaScript, and a service id
  // plus a template id plus that "public" key is the complete argument set for
  // EmailJS's send endpoint. Anyone who opened the page could have sent mail
  // through our templates.
  const serviceId = env.EMAILJS_SERVICE_ID;
  const templateId = env.EMAILJS_PWD_TEMPLATE_ID;
  const publicKey = env.EMAILJS_PUBLIC_KEY;

  if (serviceId && templateId && publicKey) {
    try {
      const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': origin,
          'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0'
        },
        body: JSON.stringify({
          service_id: serviceId,
          template_id: templateId,
          user_id: publicKey,
          template_params: {
            to_email: email,
            email: email,
            user_email: email,
            reset_url: resetUrl,
            message: `Reset your password by clicking here: ${resetUrl}`,
            subject: 'Reset your brainhalf password',
          },
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error('[auth/password-reset] EmailJS send failed:', res.status, text);
      }
    } catch (error) {
      console.error('[auth/password-reset] EmailJS error:', error);
    }
  } else if (env.EMAIL) {
    try {
      await env.EMAIL.send({
        to: email,
        from: { email: 'noreply@brainhalf.com', name: 'brainhalf' },
        subject: 'Reset your brainhalf password',
        text:
          `Someone asked to reset the password for this address.\n\n` +
          `${resetUrl}\n\n` +
          `The link expires in one hour. If this was not you, ignore this email.`,
      });
    } catch (error) {
      console.error('[auth/password-reset] send failed:', error);
    }
  } else {
    // No email configuration: log the reset link for development testing.
    console.warn(`[auth/password-reset] no email service configured. Reset URL: ${resetUrl}`);
  }

  return acknowledged;
};
