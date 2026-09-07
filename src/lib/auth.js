import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { hashToken } from './repositories/sessions.js';

const scrypt = promisify(scryptCallback);
const sessionLifetimeMs = 1000 * 60 * 60 * 12;
export const roles = ['contributor', 'literary-assistant', 'literary-custodian', 'editor', 'production', 'release-manager', 'finance-admin', 'system-admin'];

export async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  if (typeof password !== 'string' || password.length < 14) throw new Error('Password must be at least 14 characters.');
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

export async function passwordMatches(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = (await scrypt(password, salt, 64)).toString('hex');
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function ensureBootstrapAdmin({ store, config }) {
  if (!config.bootstrapAdminEmail || !config.bootstrapAdminPassword) return;
  if (store.countUsers) {
    if (await store.countUsers()) return;
    const id = randomUUID(); const createdAt = new Date().toISOString();
    await store.insertUser({ id, email: config.bootstrapAdminEmail.trim().toLowerCase(), passwordHash: await passwordHash(config.bootstrapAdminPassword), roles: ['system-admin'], createdAt });
    await store.appendAuditEvent({ id: randomUUID(), type: 'auth.bootstrap-created', subjectId: config.bootstrapAdminEmail, actorLabel: 'system' });
    return;
  }
  await store.update(async (state) => {
    if (state.users.length) return;
    const at = new Date().toISOString();
    state.users.push({ id: `user-${randomUUID()}`, email: config.bootstrapAdminEmail.trim().toLowerCase(), passwordHash: await passwordHash(config.bootstrapAdminPassword), roles: ['system-admin'], createdAt: at });
    state.auditEvents.push({ id: randomUUID(), type: 'auth.bootstrap-created', subjectId: config.bootstrapAdminEmail, at, actor: 'system' });
  });
}

export function readCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter(([key]) => key));
}

function sessionCookie(token, secure) {
  return `cw_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionLifetimeMs / 1000}${secure ? '; Secure' : ''}`;
}

export async function signIn({ store, email, password, secureCookie, cookieHeader = '' }) {
  const normalised = String(email || '').trim().toLowerCase();
  if (store.findUserByEmail) {
    const user = await store.findUserByEmail(normalised);
    if (!user || !(await passwordMatches(password, user.passwordHash))) throw new Error('Invalid email or password.');
    const token = randomBytes(32).toString('base64url'); const expiresAt = new Date(Date.now() + sessionLifetimeMs).toISOString();
    await store.createAuthenticatedSession({ tokenHash: hashToken(token), previousTokenHash: readCookies(cookieHeader).cw_session ? hashToken(readCookies(cookieHeader).cw_session) : null, userId: user.id, expiresAt, auditId: randomUUID() });
    return { user: { id: user.id, email: user.email, roles: user.roles }, cookie: sessionCookie(token, secureCookie) };
  }
  const state = await store.read();
  const user = state.users.find((item) => item.email === normalised);
  if (!user || !(await passwordMatches(password, user.passwordHash))) throw new Error('Invalid email or password.');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionLifetimeMs).toISOString();
  await store.update((next) => {
    next.sessions = next.sessions.filter((item) => new Date(item.expiresAt) > new Date());
    next.sessions.push({ token, userId: user.id, expiresAt });
    next.auditEvents.push({ id: randomUUID(), type: 'auth.signed-in', subjectId: user.id, at: new Date().toISOString(), actor: user.id });
  });
  return { user: { id: user.id, email: user.email, roles: user.roles }, cookie: sessionCookie(token, secureCookie) };
}

export async function currentActor({ store, cookieHeader, permitted }) {
  const token = readCookies(cookieHeader).cw_session;
  if (!token) throw new Error('Authentication required.');
  if (store.findSessionByTokenHash) {
    const user = await store.findSessionByTokenHash(hashToken(token));
    if (!user || !user.roles.some((role) => permitted.includes(role))) throw new Error('Forbidden.');
    return { id: user.id, email: user.email, roles: user.roles };
  }
  const state = await store.read();
  const session = state.sessions.find((item) => item.token === token && new Date(item.expiresAt) > new Date());
  const user = session && state.users.find((item) => item.id === session.userId);
  if (!user || !user.roles.some((role) => permitted.includes(role))) throw new Error('Forbidden.');
  return { id: user.id, email: user.email, roles: user.roles };
}

export async function signOut({ store, cookieHeader, secureCookie }) {
  const token = readCookies(cookieHeader).cw_session;
  if (token && store.deleteSession) await store.deleteSession(hashToken(token));
  else if (token) await store.update((state) => { state.sessions = state.sessions.filter((item) => item.token !== token); });
  return `cw_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie ? '; Secure' : ''}`;
}

export async function createUser({ store, email, password, assignedRoles, actor }) {
  const normalised = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) throw new Error('A valid email is required.');
  const selectedRoles = [...new Set(assignedRoles || [])];
  if (!selectedRoles.length || selectedRoles.some((role) => !roles.includes(role))) throw new Error('At least one valid role is required.');
  const hash = await passwordHash(password);
  if (store.findUserByEmail) {
    const user = { id: randomUUID(), email: normalised, passwordHash: hash, roles: selectedRoles, createdAt: new Date().toISOString() };
    await store.insertUserWithAudit({ ...user, actorId: actor, auditId: randomUUID() });
    return { id: user.id, email: user.email, roles: user.roles };
  }
  return store.update((state) => {
    if (state.users.some((user) => user.email === normalised)) throw new Error('A user with this email already exists.');
    const user = { id: `user-${randomUUID()}`, email: normalised, passwordHash: hash, roles: selectedRoles, createdAt: new Date().toISOString() };
    state.users.push(user);
    state.auditEvents.push({ id: randomUUID(), type: 'auth.user-created', subjectId: user.id, at: user.createdAt, actor });
    return { id: user.id, email: user.email, roles: user.roles };
  });
}
