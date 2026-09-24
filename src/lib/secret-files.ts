const BLOCKED_FILE_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)(?:\.dev\.vars(?:\.[^/]*)?|\.npmrc|\.netrc|\.pypirc|\.aws|\.ssh)(?:\/|$)/i,
  /(^|\/)(id_rsa|id_ed25519)$/i,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)(credentials|secrets)\.(json|yaml|yml|toml|ini)$/i,
];

export function isBlockedSecretFile(path: string): boolean {
  return BLOCKED_FILE_PATTERNS.some(pattern => pattern.test(path));
}
