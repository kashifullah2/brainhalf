import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountId, provisioningPolicy, setupProvisioningToken, tokenName } from '../setup-provisioning-token.mjs';

const admin = 'test_admin_' + 'a'.repeat(32);
const provisioner = 'test_provisioner_' + 'b'.repeat(32);
const createdId = 'c'.repeat(32);
const groups = [
  { id: '1'.repeat(32), name: 'D1 Write', scopes: ['com.cloudflare.api.account'] },
  { id: '2'.repeat(32), name: 'Workers Scripts Write', scopes: ['com.cloudflare.api.account'] },
  { id: '3'.repeat(32), name: 'Account API Tokens Write', scopes: ['com.cloudflare.api.account'] },
];

function fixture({ failPath, failInstall = false, existing = false, failDelete = false } = {}) {
  const calls = [];
  const installed = [];
  return {
    calls, installed,
    async request(credential, path, method = 'GET', data) {
      calls.push({ credential, path, method, data });
      if (failPath && path.includes(failPath)) throw new Error('Provider response contains ' + credential);
      if (method === 'DELETE') {
        if (failDelete) throw new Error('Removal denied');
        return { result: { id: createdId } };
      }
      if (path.endsWith('/permission_groups')) return { result: groups };
      if (path.includes('/tokens?')) return { result: existing ? [{ name: tokenName }] : [] };
      if (method === 'POST') return { result: { id: createdId, value: provisioner } };
      if (path.endsWith('/verify')) return { result: { status: 'active' } };
      return { result: [] };
    },
    async install(value) {
      installed.push(value);
      if (failInstall) throw new Error('Secret write may have succeeded: ' + value);
    },
  };
}

test('only the two account permissions are granted and admin credentials never reach installation or results', async () => {
  const f = fixture();
  const result = await setupProvisioningToken(admin, f);
  const create = f.calls.find(call => call.method === 'POST');
  assert.deepEqual(create.data, { name: tokenName, policies: [{
    effect: 'allow', resources: { [`com.cloudflare.api.account.${accountId}`]: '*' },
    permission_groups: [{ id: '1'.repeat(32) }, { id: '2'.repeat(32) }],
  }] });
  assert.deepEqual(f.installed, [provisioner]);
  assert.equal(result.installed, true);
  assert.equal(JSON.stringify(result).includes(admin), false);
  assert.equal(JSON.stringify(result).includes(provisioner), false);
  const reads = f.calls.filter(call => /\/verify|\/d1\/|\/scripts\?/.test(call.path));
  assert.equal(reads.length, 3);
  assert.ok(reads.every(call => call.credential === provisioner));
});

test('missing, ambiguous and wrong-resource permissions fail closed', () => {
  assert.throws(() => provisioningPolicy(groups.slice(0, 1)), /Workers Scripts Write/);
  assert.throws(() => provisioningPolicy([...groups, groups[0]]), /D1 Write/);
  assert.throws(() => provisioningPolicy(groups.map(group => ({ ...group, scopes: ['com.cloudflare.api.user'] }))), /D1 Write/);
});

test('an existing named token prevents a second creation or installation', async () => {
  const f = fixture({ existing: true });
  await assert.rejects(setupProvisioningToken(admin, f), /already exists/);
  assert.ok(f.calls.every(call => call.method === 'GET'));
  assert.deepEqual(f.installed, []);
});

test('a failed service check removes only the new token and leaves runtime credentials unchanged', async () => {
  const f = fixture({ failPath: '/d1/' });
  await assert.rejects(setupProvisioningToken(admin, f), error => {
    assert.match(error.message, /was removed/);
    assert.equal(error.message.includes(provisioner), false);
    return true;
  });
  assert.deepEqual(f.installed, []);
  assert.deepEqual(f.calls.filter(call => call.method === 'DELETE').map(({ credential, path }) => ({ credential, path })), [
    { credential: admin, path: `/accounts/${accountId}/tokens/${createdId}` },
  ]);
});

test('failed cleanup reports only the non-secret token ID', async () => {
  const f = fixture({ failPath: '/d1/', failDelete: true });
  await assert.rejects(setupProvisioningToken(admin, f), error => {
    assert.match(error.message, /could not be removed/);
    assert.ok(error.message.includes(createdId));
    assert.equal(error.message.includes(admin), false);
    assert.equal(error.message.includes(provisioner), false);
    return true;
  });
  assert.deepEqual(f.installed, []);
});

test('an uncertain installation never revokes a token that may now be live or leaks its value', async () => {
  const f = fixture({ failInstall: true });
  await assert.rejects(setupProvisioningToken(admin, f), error => {
    assert.match(error.message, /may have succeeded/);
    assert.equal(error.message.includes(provisioner), false);
    return true;
  });
  assert.equal(f.calls.some(call => call.method === 'DELETE'), false);
});

test('malformed token input is rejected before network or installation', async () => {
  const f = fixture();
  for (const value of ['', `Bearer ${admin}`, `${admin}\n`, `"${admin}"`]) await assert.rejects(setupProvisioningToken(value, f), /only the token value/);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.installed, []);
});
