# BrainHalf branding, accounts, and project isolation

## Implemented

- The supplied `assest/brainhalflogo.png` is cropped without distortion and used by the shared logo component, public/auth/workspace pages, email templates, favicon sizes, app icons, and social-sharing artwork. The original source is preserved.
- The public landing header has no active-project tab. Signed-in users get a Builder button; the workspace toolbar appears inside the authenticated builder.
- New projects get UUID-based IDs, clear pending prompt state, and open the chat tab. Quota and ownership failures keep the selected project and show an error, rather than silently switching to an older project.
- `/contact` sends messages through Resend to the configured inbox. It validates input, escapes HTML, limits request size, and uses the existing Worker IP rate limit. The recipient is server-configured; visitors cannot supply a destination.
- `/forgot-password`, `/reset-password`, `/verify-email`, and `/resend-verification` provide complete account email flows. They are prerendered with `noindex` and excluded from Analytics and the sitemap.
- New email/password signups must verify before login. Existing accounts retain access; Google-only accounts continue using Google. Verification is not used to automatically link Google and password accounts.
- Verification links expire after 24 hours; reset links after 30 minutes. Tokens live in URL fragments, are removed from the browser URL on arrival, and are stored only as hashes in the Registry. The user explicitly submits the verification form, so mail scanners opening links do not consume them.
- Password reset consumes its link once, revokes session records and WebSocket tickets, and preserves project ownership. Recovery and resend responses do not reveal whether an address has an eligible account.
- `codex mcp add resend --url https://mcp.resend.com/mcp` was run successfully, and Codex reported successful OAuth login. The platform uses Resend's server-side API independently of the Codex MCP connection.

## Resend configuration

In Resend, add and verify the sending domain you control, such as `brainhalf.com`. Add the exact DNS records Resend supplies to Cloudflare DNS. Create an API key allowed to send from that verified domain.

Store these Worker secrets using the interactive prompts:

```bash
cd /home/kashifullah/brainhalf
npm run wrangler -- secret put RESEND_API_KEY
npm run wrangler -- secret put RESEND_FROM_EMAIL
npm run wrangler -- secret put CONTACT_EMAIL
npm run deploy
```

- `RESEND_API_KEY`: your Resend API key.
- `RESEND_FROM_EMAIL`: `support@brainhalf.com`, on your verified Resend sending domain. Do not include a display name; the application adds BrainHalf.
- `CONTACT_EMAIL`: `admin@brainhalf.com`, the inbox receiving contact submissions.

The contact page publishes both addresses, and the shared footer links to support. These settings do not create mailboxes: inbound delivery requires existing mail hosting or email forwarding for these addresses.

Keep the existing `SESSION_SECRET` and Google credentials. No new Cloudflare binding is required. The Registry creates the new email tables idempotently, preserving existing users and projects.

Without the Resend sender configuration, new email signups and email requests return an explicit unavailable message. Login for existing accounts and Google sign-in remain available. Failed signup delivery leaves the new account pending so the user can request another verification email.

## Release checks

After deployment and domain verification, use an email account you control to create an account, follow the verification link, sign in, reset the password, and confirm that the old password no longer works. Send a contact message to verify the configured inbox. Review delivery errors in Resend if messages do not arrive.

Automated email tests use mocked Resend delivery and real Registry SQLite. No real test email was sent.

Deployed on 2026-09-22 to `brainhalf.com` and `www.brainhalf.com`, version `99d2c30f-1fe2-411d-a2bd-7729a46a1efe`. Cloudflare contains `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `CONTACT_EMAIL`; the two address settings were saved as documented above. The deployment passed 719 application tests, 9 deployment-tool tests, typecheck, lint, build, and SEO checks. Live homepage, contact, and forgot-password pages returned HTTP 200; contact links, branding, and recovery-page noindex were confirmed. Resend domain verification and actual email delivery remain unverified.

The previously diagnosed Google `redirect_uri_mismatch` still requires the Google OAuth client's authorized redirect URI to include `https://brainhalf.com/api/auth/google/callback` exactly.
