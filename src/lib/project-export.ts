import { isBlockedSecretFile } from './secret-files';
import { isSafeFilePath, normalizePath } from './utils';

const OMIT_PATH = /(^|\/)(?:\.git|node_modules|\.wrangler|\.next|dist|dist-worker|coverage|test-results|playwright-report)(?:\/|$)/i;
const PRIVATE_FILE = /(^|\/)(?:\.dev\.vars(?:\..*)?|\.npmrc|\.netrc|\.pypirc|\.aws|\.ssh)(?:\/|$)/i;
const SECRET_VALUE = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bcfut_[A-Za-z0-9]{30,}|\bbhsvc_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\b(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}|\bre_[A-Za-z0-9]{24,}|\bsk_live_[A-Za-z0-9]{20,}|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b)/;
const ENV_KEY = /^[A-Z][A-Z0-9_]{1,80}$/;
const INLINE_SECRET = /\b(?:api_?key|client_?secret|secret_?key|session_?secret|database_?url|access_?token|auth_?token)\s*[=:]\s*["']([^"'\r\n]{12,})["']/gi;
const PLATFORM_KEYS = new Set(['BRAINHALF_SERVICE_TOKEN', 'BRAINHALF_SERVICES', 'BRAINHALF_MANAGED', 'PROJECT_SECRETS_KEY', 'CF_API_TOKEN', 'PILOT_OWNER_IDS', 'DISPATCH_NAMESPACE', 'RUNTIME_SERVICE_NAME', 'RUNTIME_ENABLED']);
export interface PreparedExport { files: Record<string, string>; omitted: string[]; environmentKeys: string[]; managed: boolean }

/** Shared ZIP/GitHub boundary. Never copies live credentials or local build caches. */
export function prepareProjectExport(input: Record<string, string>): PreparedExport {
  const files: Record<string, string> = {}; const omitted: string[] = []; const keys = new Set<string>();
  let bytes = 0; let count = 0;
  for (const [raw, content] of Object.entries(input)) {
    // Control characters in paths are intentionally rejected.
    // eslint-disable-next-line no-control-regex
    if (!isSafeFilePath(raw) || typeof content !== 'string' || /[:\u0000-\u001f\u007f]/.test(raw)) { omitted.push(raw); continue; }
    const path = normalizePath(raw);
    if (/\/(?:\.env|\.dev\.vars)(?:\.[^/]*)?$/i.test(path)) {
      for (const line of content.split('\n')) { const key = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]+)\s*=/)?.[1]; if (key && !PLATFORM_KEYS.has(key)) keys.add(key); }
      omitted.push(path); continue;
    }
    if (OMIT_PATH.test(path) || PRIVATE_FILE.test(path) || isBlockedSecretFile(path)) { omitted.push(path); continue; }
    if (SECRET_VALUE.test(content)) throw new Error(`Export stopped: ${path} contains a credential. Move it to server-side environment settings and remove it from source before exporting.`);
    for (const match of content.matchAll(INLINE_SECRET)) if (!/^(?:your[_ -]|replace[_ -]|example|placeholder|test[_ -]|\$\{|<)/i.test(match[1])) throw new Error(`Export stopped: ${path} has a hardcoded secret setting. Use a server environment variable and export again.`);
    if (Object.prototype.hasOwnProperty.call(files, path)) {
      if (files[path] !== content) throw new Error(`Export stopped: duplicate paths resolve to ${path}. Rename the conflicting file first.`);
      continue;
    }
    bytes += new TextEncoder().encode(content).byteLength;
    if (bytes > 10_000_000 || ++count > 500) throw new Error('Export is limited to 500 source files and 10 MB. Remove generated build output and try again.');
    files[path] = content;
    for (const match of content.matchAll(/(?:process\.env\.|import\.meta\.env\.|\benv\.)([A-Z][A-Z0-9_]+)/g)) if (ENV_KEY.test(match[1]) && !PLATFORM_KEYS.has(match[1]) && !['NODE_ENV', 'MODE', 'DEV', 'PROD', 'BASE_URL', 'DB', 'ASSETS'].includes(match[1])) keys.add(match[1]);
  }
  let managed = false;
  try { managed = JSON.parse(files['/package.json'] || '{}').brainhalf?.runtime === 'workers'; } catch { /* Preserve invalid user JSON for review. */ }
  if (managed) for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'CONTACT_EMAIL', 'SESSION_SECRET']) keys.add(key);
  const environmentKeys = [...keys].filter(key => ENV_KEY.test(key)).sort();
  const example = '# Supply your own values locally or in your hosting provider. Never commit filled secret files.\n# VITE_* and NEXT_PUBLIC_* values are visible in browsers: use them only for public configuration.\n' + environmentKeys.map(key => `${key}=`).join('\n') + '\n';
  files['/.env.example'] = example;
  if (managed) files['/.dev.vars.example'] = example;
  const ignore = ['.env', '.env.*', '!.env.example', '.dev.vars', '.dev.vars.*', '!.dev.vars.example', '.wrangler/', 'node_modules/', 'dist/', 'dist-worker/'];
  files['/.gitignore'] = [...new Set([...(files['/.gitignore'] || '').split('\n'), ...ignore])].join('\n').trim() + '\n';
  files['/BRAINHALF_EXPORT.md'] = `# Run and deploy your exported project\n\nThis export contains your project source. BrainHalf account credentials, sessions, project service tokens and hosted data are not included.\n\n1. Install the dependencies declared in package.json. Review its scripts before running them.\n2. Copy .env.example to the local environment file your framework uses and enter your own values. Server secrets must never use VITE_ or NEXT_PUBLIC_ prefixes.\n3. Follow your project README and FULLSTACK.md, then run its tests and build before deployment.\n4. Provision your own database/storage and configure Google callback URLs and your verified email sender. Data stored on BrainHalf is separate from a source download.\n\n${managed ? '## Managed Workers services\n\nOn BrainHalf, authentication, email, private uploads and DB are supplied by runtime bindings. Those services are not transferable credentials. For standalone deployment, configure your own Workers/D1 resources and authentication/email/storage adapters; copying provider keys alone does not recreate the hosted runtime. The generated backend refuses private requests until a trusted authentication layer is installed. Never set BRAINHALF_MANAGED=true on a public Worker without stripping client identity headers and validating sessions first. Keep BRAINHALF_SERVICE_TOKEN out of local configuration: it belongs only to BrainHalf hosting.\n\nUse .dev.vars.example for Wrangler local secrets, and wrangler secret put for your production secrets. Google/Resend credentials belong in your server environment, never the frontend.\n' : ''}\n## Export filtering\n\nLocal secret files, private keys, build output and dependency caches are omitted. Environment examples contain names and empty values only. Review your source for application-specific credentials before publishing it.\n`;
  return { files, omitted, environmentKeys, managed };
}
