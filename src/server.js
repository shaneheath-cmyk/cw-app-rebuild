import { createServer } from 'node:http';
import { access, readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { getConfig } from './lib/config.js';
import { FileStore } from './lib/store.js';
import { createRepositories } from './lib/repositories/index.js';
import { createDeposit, parseRetrievedDeposit, retrieveDeposit } from './lib/custody.js';
import { applyStripeEvent, createCheckout, products, verifyWebhook } from './lib/stripe.js';
import { createUser, currentActor, ensureBootstrapAdmin, signIn, signOut } from './lib/auth.js';

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function json(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function securityHeaders(response) {
  response.setHeader('content-security-policy', "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
  response.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('x-content-type-options', 'nosniff');
}

async function body(request, limit = 6 * 1024 * 1024) {
  if (Number(request.headers['content-length'] || 0) > limit) throw Object.assign(new Error('Request exceeds permitted size.'), { code: 'REQUEST_TOO_LARGE' });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request exceeds permitted size.'), { code: 'REQUEST_TOO_LARGE' });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createStore(config) {
  // Fail closed. Without this guard an unset or mistyped DATABASE_URL started the service
  // successfully on the file store: a synthetic catalogue, a fresh bootstrap admin, and every
  // subsequent write diverging silently from the real database.
  if (!config.databaseUrl) {
    if (config.nodeEnv === 'production') throw new Error('DATABASE_URL is required when NODE_ENV=production. Refusing to start on the file store.');
    return new FileStore(config.dataDirectory);
  }
  if (config.nodeEnv === 'production' && !['127.0.0.1', '::1', 'localhost'].includes(config.bindHost)) throw new Error('Production runtime must remain loopback-bound until explicit public-exposure authorization.');
  // Production begins with no synthetic catalogue records; imports establish canon.
  return createRepositories(config.databaseUrl);
}

export function createApp({ config = getConfig(), store = createStore(config) } = {}) {
  const publicDirectory = config.nodeEnv === 'production' ? join(process.cwd(), 'dist') : join(process.cwd(), 'src', 'public');
  const secureCookie = config.publicOrigin.startsWith('https://');
  const actor = (request, permitted) => currentActor({ store, cookieHeader: request.headers.cookie, permitted });
  const ready = access(publicDirectory).then(() => store.initialise()).then(() => ensureBootstrapAdmin({ store, config }));
  return createServer(async (request, response) => {
    try {
      await ready;
      securityHeaders(response);
      const url = new URL(request.url, config.publicOrigin);
      if (request.method === 'GET' && url.pathname === '/api/health') return json(response, 200, { status: 'ok', store: config.databaseUrl ? 'postgresql' : 'file', stripeMode: config.stripeSecretKey ? (config.stripeSecretKey.startsWith('sk_live_') ? 'live' : 'test') : 'unconfigured' });
      if (request.method === 'POST' && url.pathname === '/api/auth/login') {
        const input = JSON.parse(await body(request, 32 * 1024));
        const result = await signIn({ store, email: input.email, password: input.password, secureCookie, cookieHeader: request.headers.cookie, sourceIp: request.socket.remoteAddress });
        response.setHeader('set-cookie', result.cookie);
        return json(response, 200, { user: result.user });
      }
      if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        response.setHeader('set-cookie', await signOut({ store, cookieHeader: request.headers.cookie, secureCookie }));
        return json(response, 204, {});
      }
      if (request.method === 'GET' && url.pathname === '/api/auth/me') {
        const user = await actor(request, ['contributor', 'literary-assistant', 'literary-custodian', 'editor', 'production', 'release-manager', 'system-admin']);
        return json(response, 200, { user });
      }
      if (request.method === 'POST' && url.pathname === '/api/admin/users') {
        const current = await actor(request, ['system-admin']);
        const input = JSON.parse(await body(request, 32 * 1024));
        const user = await createUser({ store, email: input.email, password: input.password, assignedRoles: input.roles, actor: current.id });
        return json(response, 201, { user });
      }
      if (request.method === 'GET' && url.pathname === '/api/library') {
        return json(response, 200, { works: (await store.listWorks()).map((work) => ({ ...work, digitalPriceCents: products[work.digitalProductCode]?.amount ?? null })) });
      }
      if (request.method === 'GET' && url.pathname === '/api/operations') {
        await actor(request, ['literary-custodian', 'editor', 'production', 'release-manager', 'system-admin']);
        return json(response, 200, { deposits: await store.listForOperations(100), tasks: await store.listOpenTasks(), auditEvents: await store.listRecentAuditEvents(30) });
      }
      if (request.method === 'POST' && url.pathname === '/api/deposits') {
        const currentActor = await actor(request, ['contributor', 'literary-custodian', 'system-admin']);
        const input = JSON.parse(await body(request));
        const deposit = await createDeposit({ ...input, storageRoot: config.storageRoot, store, submittedBy: currentActor.id });
        return json(response, 201, { deposit });
      }
      if (request.method === 'POST' && /^\/api\/deposits\/[^/]+\/retrieve$/.test(url.pathname)) {
        const currentActor = await actor(request, ['literary-assistant', 'literary-custodian', 'system-admin']);
        const depositId = url.pathname.split('/')[3];
        return json(response, 200, await retrieveDeposit({ store, depositId, actor: currentActor.id }));
      }
      if (request.method === 'POST' && /^\/api\/deposits\/[^/]+\/parse$/.test(url.pathname)) {
        const currentActor = await actor(request, ['literary-assistant', 'system-admin']);
        const depositId = url.pathname.split('/')[3];
        return json(response, 200, { parse: await parseRetrievedDeposit({ storageRoot: config.storageRoot, store, depositId, actor: currentActor.id }) });
      }
      if (request.method === 'POST' && url.pathname === '/api/checkout') {
        const current = await actor(request, ['contributor', 'literary-assistant', 'literary-custodian', 'editor', 'production', 'release-manager', 'finance-admin', 'system-admin']);
        await store.consumeCheckoutQuota({ subject: `checkout:${current.id}` });
        const input = JSON.parse(await body(request, 32 * 1024));
        return json(response, 201, await createCheckout({ productCode: input.productCode, config }));
      }
      if (request.method === 'POST' && url.pathname === '/api/webhooks/stripe') {
        const rawBody = await body(request, 1024 * 1024);
        if (!verifyWebhook(rawBody, request.headers['stripe-signature'], config.stripeWebhookSecret)) return json(response, 401, { error: 'Invalid webhook signature.' });
        return json(response, 200, await applyStripeEvent({ store, event: JSON.parse(rawBody) }));
      }
      if (request.method === 'GET' && url.pathname === '/studio.html') {
        const user = await actor(request, ['contributor', 'literary-assistant', 'literary-custodian', 'editor', 'production', 'release-manager', 'system-admin']).catch(() => null);
        if (!user) {
          response.writeHead(302, { location: '/login.html?next=%2Fstudio.html' });
          return response.end();
        }
      }

      if (request.method === 'GET') {
        const requested = url.pathname === '/' ? '/index.html' : url.pathname;
        if (!/^\/[a-zA-Z0-9._/-]+$/.test(requested) || requested.includes('..')) return json(response, 404, { error: 'Not found.' });
        const file = join(publicDirectory, requested);
        const content = await readFile(file);
        response.writeHead(200, { 'content-type': mimeTypes[extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
        return response.end(content);
      }
      return json(response, 404, { error: 'Not found.' });
    } catch (error) {
      const statusByCode = { AUTHENTICATION_REQUIRED: 401, FORBIDDEN: 403, DUPLICATE_DEPOSIT: 409, REQUEST_TOO_LARGE: 413, RATE_LIMITED: 429 };
      const status = statusByCode[error.code] || (error instanceof SyntaxError ? 400 : error.code === 'ENOENT' ? 404 : 422);
      if (!statusByCode[error.code] && !(error instanceof SyntaxError) && error.code !== 'ENOENT') console.error(error);
      const safeMessage = status === 401 ? 'Authentication required.' : status === 403 ? 'Forbidden.' : status === 400 ? 'Malformed JSON.' : status === 404 ? 'Not found.' : status === 409 ? 'An identical source artifact has already been deposited.' : status === 413 ? 'Request exceeds permitted size.' : status === 429 ? 'Too many requests.' : 'Request failed.';
      if (status === 429) response.setHeader('retry-after', String(error.retryAfter || 900));
      return json(response, status, { error: safeMessage });
    }
  });
}

if (process.argv[1] && new URL(`file://${process.argv[1]}`).href === import.meta.url) {
  const config = getConfig();
  const app = createApp({ config });
  app.listen(config.port, config.bindHost, () => console.log(`CW Library listening at ${config.publicOrigin}`));
}
