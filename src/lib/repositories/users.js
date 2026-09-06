import { one, query } from './base.js'; import { text, textArray, uuid } from '../sql.js';
export function users(databaseUrl) { return {
  findUserByEmail: (email) => one(databaseUrl, `select row_to_json(u) from (select id, email, password_hash as "passwordHash", roles, created_at as "createdAt" from app_user where email = ${text(email)}) u;`),
  countUsers: () => query(databaseUrl, 'select count(*) from app_user;', true).then(Number),
  insertUser: async ({ id, email, passwordHash, roles, createdAt }) => one(databaseUrl, `insert into app_user (id,email,password_hash,roles,created_at) values (${uuid(id)},${text(email)},${text(passwordHash)},${textArray(roles)},${text(createdAt)}::timestamptz) returning row_to_json(app_user);`),
}; }
