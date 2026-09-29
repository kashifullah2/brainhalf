import { RuntimeError, type IntegrationConfig, type IntegrationProvider } from './types';

const encoder = new TextEncoder();
const toBase64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const fromBase64 = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0));

async function encryptionKey(secret: string): Promise<CryptoKey> {
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = fromBase64(secret); } catch { throw new RuntimeError('Project secret storage is not configured.', 503); }
  if (bytes.length !== 32) throw new RuntimeError('Project secret storage is not configured.', 503);
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealSecret(value: unknown, masterKey: string, scope: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(scope) }, await encryptionKey(masterKey), encoder.encode(JSON.stringify(value)));
  return JSON.stringify({ version: 1, iv: toBase64(iv), data: toBase64(new Uint8Array(ciphertext)) });
}
export async function openSecret<T>(sealed: string, masterKey: string, scope: string): Promise<T> {
  const envelope = JSON.parse(sealed) as { version: number; iv: string; data: string };
  if (envelope.version !== 1) throw new RuntimeError('Unsupported secret version.', 503);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv), additionalData: encoder.encode(scope) }, await encryptionKey(masterKey), fromBase64(envelope.data));
  return JSON.parse(new TextDecoder().decode(data)) as T;
}

const email = (value: unknown): value is string => typeof value === 'string' && value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
function text(value: unknown, max = 2048): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\r\n\0]/.test(value); }
export function validateIntegration(provider: IntegrationProvider, value: Record<string, unknown>, previous?: IntegrationConfig[IntegrationProvider]): IntegrationConfig[IntegrationProvider] {
  if (provider === 'resend') {
    const old = previous as IntegrationConfig['resend'];
    const apiKey = value.apiKey || old?.apiKey;
    if (!text(apiKey) || !apiKey.startsWith('re_')) throw new RuntimeError('Enter a valid Resend API key.');
    if (!email(value.from) || !email(value.contactTo)) throw new RuntimeError('Enter a verified sender address and a contact destination.');
    const webhookSecret = value.webhookSecret || old?.webhookSecret;
    if (webhookSecret && (!text(webhookSecret) || !webhookSecret.startsWith('whsec_'))) throw new RuntimeError('Enter a valid signing secret.');
    return { apiKey, from: value.from, contactTo: value.contactTo, ...(typeof webhookSecret === 'string' ? { webhookSecret } : {}) };
  }
  if (provider === 'github') {
    const clientSecret = value.clientSecret || (previous as IntegrationConfig['github'])?.clientSecret;
    if (!text(value.clientId, 255) || !/^(Ov[0-9A-Za-z]{10,}|Iv1\.[0-9a-f]{16}|[0-9a-f]{20})$/.test(value.clientId)) throw new RuntimeError('Enter a GitHub OAuth client ID.');
    if (!text(clientSecret, 255)) throw new RuntimeError('Enter the GitHub OAuth client secret.');
    return { clientId: value.clientId, clientSecret };
  }
  if (provider !== 'google') throw new RuntimeError('Unknown integration.');
  const clientSecret = value.clientSecret || (previous as IntegrationConfig['google'])?.clientSecret;
  if (!text(value.clientId) || !value.clientId.endsWith('.apps.googleusercontent.com')) throw new RuntimeError('Enter a Google OAuth web client ID.');
  if (!text(clientSecret)) throw new RuntimeError('Enter the Google OAuth client secret.');
  return { clientId: value.clientId, clientSecret };
}

export function redactSecrets(message: string, values: string[] = []): string {
  let result = message.replace(/\b(re_[A-Za-z0-9_-]+|GOCSPX-[A-Za-z0-9_-]+|whsec_[A-Za-z0-9_+/=-]+|cfut_[A-Za-z0-9]+|(?:ghp_|github_pat_)[A-Za-z0-9_]+|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|bhsvc_[A-Za-z0-9_.-]+)\b/g, '[redacted]');
  for (const value of values) if (value.length >= 6) result = result.split(value).join('[redacted]');
  return result.slice(0, 16_000);
}
