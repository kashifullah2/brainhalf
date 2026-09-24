import { base64urlDecodeString, base64urlEncodeString, hmacSign, hmacVerify } from '../lib/crypto';
import { assertScope, environmentFrom, RuntimeError, type ProjectEnvironment, type ProjectScope } from './types';

export async function serviceCapability(scope: ProjectScope, environment: ProjectEnvironment, secret: string) {
  if (!secret) throw new RuntimeError('Project services are not configured.', 503);
  const payload = base64urlEncodeString(JSON.stringify({ ...scope, environment }));
  return `bhsvc_${payload}.${await hmacSign(secret, 'app-services:v1:' + payload)}`;
}
export async function verifyServiceCapability(value: string, secret: string): Promise<ProjectScope & { environment: ProjectEnvironment }> {
  if (!secret || value.length > 1500 || !value.startsWith('bhsvc_')) throw new RuntimeError('Invalid app service credential.', 401);
  const [payload, signature, extra] = value.slice(6).split('.');
  if (!payload || !signature || extra || !await hmacVerify(secret, 'app-services:v1:' + payload, signature)) throw new RuntimeError('Invalid app service credential.', 401);
  let data: Record<string, unknown>;
  try { data = JSON.parse(base64urlDecodeString(payload) || 'null'); } catch { throw new RuntimeError('Invalid app service credential.', 401); }
  if (!data || typeof data.projectId !== 'string' || typeof data.ownerId !== 'string') throw new RuntimeError('Invalid app service scope.', 401);
  const scope = { projectId: data.projectId, ownerId: data.ownerId }; assertScope(scope);
  return { ...scope, environment: environmentFrom(data.environment) };
}
