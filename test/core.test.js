import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { FileStore } from '../src/lib/store.js';
import { createDeposit, retrieveDeposit } from '../src/lib/custody.js';
import { applyStripeEvent, createCheckout, products, stripeMode, verifyWebhook } from '../src/lib/stripe.js';
import { createApp } from '../src/server.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'cw-'));
  const store = new FileStore(join(root, 'data'));
  return { root, store };
}

test('staged deposit retains checksum and creates review work on retrieval', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const deposit = await createDeposit({ storageRoot: join(root, 'storage'), store, submittedBy: 'author-1', filename: '../draft.txt', content: 'First manuscript draft.', declaredRights: 'I control the submission rights.' });
  assert.equal(deposit.status, 'staged');
  assert.equal(deposit.filename, '.._draft.txt');
  const retrieved = await retrieveDeposit({ store, depositId: deposit.id, actor: 'assistant-1' });
  assert.equal(retrieved.deposit.status, 'retrieved');
  assert.equal(retrieved.task.type, 'intake-review');
});

test('Stripe signature accepts a current signed payload and rejects a forged one', () => {
  const secret = 'whsec_test_secret';
  const raw = '{"id":"evt_1"}';
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  assert.equal(verifyWebhook(raw, `t=${timestamp},v1=${signature}`, secret), true);
  assert.equal(verifyWebhook(raw, `t=${timestamp},v1=deadbeef`, secret), false);
});

test('Stripe event fulfilment is idempotent', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const event = { id: `evt-${randomUUID()}`, type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 1495, currency: 'aud', customer_details: { email: 'reader@example.com' }, metadata: { product_code: 'title-beneath-black-trees-digital' } } } };
  assert.equal((await applyStripeEvent({ store, event })).repeated, false);
  assert.equal((await applyStripeEvent({ store, event })).repeated, true);
  const state = await store.read();
  assert.equal(state.orders.length, 1);
  assert.equal(state.entitlements.length, 1);
});

test('commercial policy uses approved live price amounts', () => {
  assert.equal(products['cw-membership-monthly'].amount, 1995);
  assert.equal(products['title-beneath-black-trees-digital'].amount, 1495);
  assert.equal(stripeMode('sk_live_example'), 'live');
  assert.equal(stripeMode('sk_test_example'), 'test');
});

test('checkout refuses an unapproved live price', async () => {
  await assert.rejects(() => createCheckout({ productCode: 'cw-membership-monthly', config: { stripeSecretKey: 'sk_live_example', stripePrices: {}, publicOrigin: 'http://example.test' } }), /approved live Stripe price/);
});

test('HTTP service exposes a public health and catalogue boundary', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = createApp({ config: { port: 0, dataDirectory: join(root, 'data'), storageRoot: join(root, 'storage'), publicOrigin: 'http://127.0.0.1', stripeSecretKey: '', stripeWebhookSecret: '' }, store });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const port = app.address().port;
  const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
  const library = await fetch(`http://127.0.0.1:${port}/api/library`).then((response) => response.json());
  assert.equal(health.status, 'ok');
  assert.equal(library.works.length, 1);
});

test('privileged HTTP workflow requires a CW session and preserves approval boundaries', async (t) => {
  const { root, store } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = { port: 0, dataDirectory: join(root, 'data'), storageRoot: join(root, 'storage'), publicOrigin: 'http://127.0.0.1', stripeSecretKey: '', stripeWebhookSecret: '', stripePrices: {}, bootstrapAdminEmail: 'editor@example.com', bootstrapAdminPassword: 'BootstrapPass123!' };
  const app = createApp({ config, store });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const origin = `http://127.0.0.1:${app.address().port}`;
  assert.equal((await fetch(`${origin}/api/operations`)).status, 401);
  const studioRedirect = await fetch(`${origin}/studio.html`, { redirect: 'manual' });
  assert.equal(studioRedirect.status, 302);
  assert.equal(studioRedirect.headers.get('location'), '/login.html?next=%2Fstudio.html');
  const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'editor@example.com', password: 'BootstrapPass123!' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  const authorised = { 'content-type': 'application/json', cookie };
  assert.equal((await fetch(`${origin}/studio.html`, { headers: { cookie } })).status, 200);
  const newUser = await fetch(`${origin}/api/admin/users`, { method: 'POST', headers: authorised, body: JSON.stringify({ email: 'contributor@example.com', password: 'ContributorPass123!', roles: ['contributor'] }) });
  assert.equal(newUser.status, 201);
  const depositResponse = await fetch(`${origin}/api/deposits`, { method: 'POST', headers: authorised, body: JSON.stringify({ filename: 'sample.txt', content: 'Chapter One\nA careful opening.', declaredRights: 'I control the submission rights.', intendedTitle: 'Sample Work', intendedAuthor: 'Known Author' }) });
  assert.equal(depositResponse.status, 201);
  const { deposit } = await depositResponse.json();
  assert.equal((await fetch(`${origin}/api/deposits/${deposit.id}/retrieve`, { method: 'POST', headers: authorised })).status, 200);
  const parsed = await fetch(`${origin}/api/deposits/${deposit.id}/parse`, { method: 'POST', headers: authorised });
  assert.equal(parsed.status, 200);
  assert.equal((await parsed.json()).parse.wordCount, 5);
  const state = await store.read();
  assert.equal(state.deposits[0].status, 'parsed');
  assert.equal(state.tasks.filter((task) => task.type === 'catalogue-approval').length, 1);
});
