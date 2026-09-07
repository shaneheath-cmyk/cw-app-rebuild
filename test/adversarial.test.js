import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { FileStore } from '../src/lib/store.js';
import { hashToken } from '../src/lib/repositories/sessions.js';

async function harness(t) {
  const root = await mkdtemp(join(tmpdir(), 'cw-adversarial-'));
  const config = { nodeEnv: 'test', port: 0, bindHost: '127.0.0.1', dataDirectory: join(root, 'data'), storageRoot: join(root, 'storage'), publicOrigin: 'http://127.0.0.1', stripeSecretKey: '', stripeWebhookSecret: '', stripePrices: {}, bootstrapAdminEmail: 'admin@example.test', bootstrapAdminPassword: 'BootstrapPass123!' };
  const store = new FileStore(config.dataDirectory);
  const app = createApp({ config, store });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${app.address().port}`;
  const login = async (email, password) => fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const adminLogin = await login(config.bootstrapAdminEmail, config.bootstrapAdminPassword);
  assert.equal(adminLogin.status, 200, 'positive control: bootstrap administrator can sign in');
  return { root, config, origin, login, store, adminCookie: adminLogin.headers.get('set-cookie') };
}

function authenticated(cookie, body) { return { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }; }

test('adversarial: contributor cannot access operations or create an administrator', async (t) => {
  const { origin, adminCookie, login } = await harness(t);
  const created = await fetch(`${origin}/api/admin/users`, authenticated(adminCookie, { email: 'writer@example.test', password: 'ContributorPass123!', roles: ['contributor'] }));
  assert.equal(created.status, 201, 'positive control: administrator can create contributor');
  const contributor = await login('writer@example.test', 'ContributorPass123!');
  const cookie = contributor.headers.get('set-cookie');
  assert.equal((await fetch(`${origin}/api/operations`, { headers: { cookie } })).status, 403);
  assert.equal((await fetch(`${origin}/api/admin/users`, authenticated(cookie, { email: 'forbidden@example.test', password: 'AnotherPass123!', roles: ['system-admin'] }))).status, 403);
  const adminLogin = await login('forbidden@example.test', 'AnotherPass123!');
  assert.notEqual(adminLogin.status, 200, 'negative action created no privileged user');
});

test('adversarial: deposit traversal is contained inside its staging directory', async (t) => {
  const { root, origin, adminCookie } = await harness(t);
  const response = await fetch(`${origin}/api/deposits`, authenticated(adminCookie, { filename: '../../../../evil.txt', content: 'contained source', declaredRights: 'test rights' }));
  assert.equal(response.status, 201, 'positive control: valid deposit is accepted');
  const { deposit } = await response.json();
  assert.equal(/[\\/]/.test(deposit.filename), false);
  await stat(join(root, 'storage', '01-staging', deposit.id, deposit.filename));
  await assert.rejects(stat(join(root, 'evil.txt')));
});

test('adversarial: encoded traversal is rejected while a legitimate static asset loads', async (t) => {
  const { origin } = await harness(t);
  const legitimate = await fetch(`${origin}/index.html`);
  assert.equal(legitimate.status, 200, 'positive control: normal static asset loads');
  const variants = ['/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2fetc/passwd', '/%252e%252e%252fetc/passwd', '/%2e%2e%5csecret', '/%2e./%2e./secret'];
  for (const path of variants) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 404, path);
    assert.equal((await response.text()).includes('root:'), false, path);
  }
});

test('adversarial: security headers are emitted on public and protected responses', async (t) => {
  const { origin } = await harness(t);
  for (const response of [await fetch(`${origin}/api/health`), await fetch(`${origin}/api/operations`)]) {
    assert.match(response.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
  }
});

test('adversarial: malformed, absent, bogus, and expired sessions return 401', async (t) => {
  const { origin, store } = await harness(t);
  for (const cookie of ['', 'cw_session=bogus', 'cw_session=%']) {
    const response = await fetch(`${origin}/api/operations`, { headers: cookie ? { cookie } : {} });
    assert.equal(response.status, 401, cookie || 'absent cookie');
    assert.equal((await response.text()).includes('URI malformed'), false);
  }
  await store.insertSession({ tokenHash: hashToken('expired'), userId: (await store.read()).users[0].id, expiresAt: new Date(0).toISOString() });
  assert.equal((await fetch(`${origin}/api/operations`, { headers: { cookie: 'cw_session=expired' } })).status, 401);
});

test('adversarial: invalid credentials and malformed JSON return safe client errors', async (t) => {
  const { origin } = await harness(t);
  const invalid = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@example.test', password: 'wrong-password' }) });
  assert.equal(invalid.status, 401);
  const malformed = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, 'Malformed JSON.');
});
test.todo('WP-4: checkout requires a session and webhook oversize payload is rejected before HMAC');
test.todo('WP-4: sixth failed login receives 429 and Retry-After');
test.todo('WP-9: session-token hash differs from stored row in the PostgreSQL runtime');
