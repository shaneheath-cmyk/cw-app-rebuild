import { createHash } from 'node:crypto'; import { one, query } from './base.js'; import { nullable, text, timestamp, uuid } from '../sql.js';
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export function sessions(databaseUrl) { return {
  findSessionByTokenHash: (tokenHash) => one(databaseUrl, `select row_to_json(s) from (select s.user_id as "userId", u.id, u.email, u.roles from user_session s join app_user u on u.id=s.user_id where s.token_hash=${text(tokenHash)} and s.expires_at > now()) s;`),
  insertSession: ({ tokenHash, userId, expiresAt }) => query(databaseUrl, `insert into user_session (token_hash,user_id,expires_at) values (${text(tokenHash)},${uuid(userId)},${timestamp(expiresAt)});`),
  deleteSession: (tokenHash) => query(databaseUrl, `delete from user_session where token_hash=${text(tokenHash)};`),
  pruneSessions: () => query(databaseUrl, 'delete from user_session where expires_at <= now();'),
  // Password verification is intentionally completed in Node before this one-spawn transaction.
  createAuthenticatedSession: ({ tokenHash, previousTokenHash, userId, expiresAt, auditId }) => query(databaseUrl, `begin; delete from user_session where expires_at <= now() or token_hash=${nullable(text, previousTokenHash)}; insert into user_session (token_hash,user_id,expires_at) values (${text(tokenHash)},${uuid(userId)},${timestamp(expiresAt)}); insert into audit_event (id,type,subject_id,actor_id,actor_label) values (${uuid(auditId)},'auth.signed-in',${text(userId)},${uuid(userId)},'user'); commit;`),
}; }
