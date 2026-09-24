import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { assertNodeVersion, isMain, projectRoot } from './wrangler.mjs';

export const accountId = '12fc31472161e3ebb8a01b4722ec1725';
export const tokenName = 'brainhalf-runtime-provisioning';
const accountPath = `/accounts/${accountId}`;
const requiredPermissions = ['D1 Write', 'Workers Scripts Write'];

function validToken(value) {
  return typeof value === 'string' && value.length >= 30 && value.length <= 512 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function provisioningPolicy(groups) {
  if (!Array.isArray(groups)) throw new Error('Cloudflare did not return permission definitions.');
  return [{
    effect: 'allow',
    resources: { [`com.cloudflare.api.account.${accountId}`]: '*' },
    permission_groups: requiredPermissions.map(name => {
      const matches = groups.filter(group => group?.name === name && group.scopes?.includes('com.cloudflare.api.account'));
      if (matches.length !== 1 || !/^[a-f0-9]{32}$/.test(matches[0].id)) throw new Error(`Cannot resolve the account permission: ${name}.`);
      return { id: matches[0].id };
    }),
  }];
}

export async function cloudflareRequest(credential, path, method = 'GET', data) {
  let response;
  let body;
  try {
    response = await fetch('https://api.cloudflare.com/client/v4' + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    body = await response.json();
  } catch {
    throw new Error(`Cloudflare ${method} request failed; no response details were logged.`);
  }
  if (!response.ok || body?.success !== true) {
    const codes = Array.isArray(body?.errors) ? body.errors.map(error => error?.code).filter(Number.isSafeInteger).slice(0, 5).join(', ') : '';
    throw new Error(`Cloudflare ${method} denied the request: HTTP ${response.status}${codes ? `, code ${codes}` : ''}.`);
  }
  return body;
}

export function installRuntimeSecret(value) {
  const environment = { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: value, WRANGLER_LOG: 'error' };
  for (const key of ['NODE_TEST_CONTEXT', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'CF_API_KEY', 'CF_EMAIL', 'CF_API_TOKEN', 'CLOUDFLARE_ENV']) delete environment[key];
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [join(projectRoot, 'scripts/wrangler.mjs'), 'secret', 'put', 'CF_API_TOKEN', '--config', join(projectRoot, 'wrangler.runtime.jsonc')], {
      cwd: projectRoot, env: environment, timeout: 120_000, maxBuffer: 1024 * 1024,
    }, error => {
      // Never print subprocess output or errors: they can include command environment details.
      if (error) reject(new Error('Wrangler could not confirm secret installation.'));
      else resolve();
    });
    child.stdin.on('error', () => {});
    child.stdin.end(value + '\n');
  });
}

export async function setupProvisioningToken(adminToken, { request = cloudflareRequest, install = installRuntimeSecret } = {}) {
  if (!validToken(adminToken)) throw new Error('Enter only the token value, without quotes, spaces, or a Bearer prefix.');
  const groups = await request(adminToken, accountPath + '/tokens/permission_groups');
  const policies = provisioningPolicy(groups.result);
  for (let page = 1; ; page++) {
    const listing = await request(adminToken, `${accountPath}/tokens?per_page=100&page=${page}`);
    if (!Array.isArray(listing.result)) throw new Error('Cloudflare returned an invalid token list.');
    if (listing.result.some(token => token?.name === tokenName)) throw new Error(`A token named ${tokenName} already exists. Stop here and inspect it before creating another.`);
    const pages = listing.result_info?.total_pages;
    if ((Number.isSafeInteger(pages) && page >= pages) || listing.result.length < 100) break;
    if (page >= 100) throw new Error('Token listing exceeded the setup limit. No token was created.');
  }
  // Never automatically retry a create request: a lost response may still have created a token.
  const created = await request(adminToken, accountPath + '/tokens', 'POST', { name: tokenName, policies });
  const { id, value } = created.result || {};
  if (!/^[a-f0-9]{32}$/.test(id || '') || !validToken(value)) throw new Error('Cloudflare did not return a usable new token. Inspect the token list before retrying.');
  try {
    const verified = await request(value, accountPath + '/tokens/verify');
    if (verified.result?.status !== 'active') throw new Error('New token is not active.');
    await request(value, accountPath + '/d1/database?per_page=1');
    await request(value, accountPath + '/workers/dispatch/namespaces/brainhalf-projects/scripts?per_page=1');
  } catch {
    try {
      await request(adminToken, accountPath + '/tokens/' + id, 'DELETE');
    } catch {
      throw new Error(`New token failed access checks and could not be removed (token ID ${id}). The runtime secret was not changed.`);
    }
    throw new Error('New token failed access checks and was removed. The runtime secret was not changed.');
  }
  try {
    await install(value);
  } catch {
    // A failed response can follow a successful remote write. Do not revoke a possibly installed token.
    throw new Error(`Could not confirm installation of token ${id}. It was retained because the secret write may have succeeded. Check the runtime before retrying.`);
  }
  return { tokenId: id, tokenName, accountId, readAccess: true, installed: true };
}

function readHiddenToken() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this command in an interactive terminal. Do not pass the token as an argument.');
  return new Promise((resolve, reject) => {
    let value = '';
    const priorRaw = process.stdin.isRaw;
    process.stdout.write('Paste the brain_half token (hidden), then press Enter: ');
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    const finish = (error) => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(priorRaw);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onData = chunk => {
      for (const character of chunk) {
        if (character === '\u0003' || character === '\u0004') return finish(new Error('Setup cancelled.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else value += character;
        if (value.length > 512) return finish(new Error('Token input is too long.'));
      }
    };
    process.stdin.on('data', onData);
  });
}

if (isMain(import.meta.url)) {
  try {
    assertNodeVersion();
    if (process.argv.length !== 2) throw new Error('This command takes no arguments. Enter the token only in its hidden prompt.');
    console.log('Creates a D1 + Workers Scripts token for BrainHalf and installs CF_API_TOKEN on brainhalf-runtime.');
    const result = await setupProvisioningToken(await readHiddenToken());
    console.log(JSON.stringify(result));
    console.log('Provisioning secret installed. Hosting was not enabled; live project provisioning still needs validation.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
