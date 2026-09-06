import { many, query } from './base.js'; import { int, nullable, text, uuid } from '../sql.js';
export function audit(databaseUrl) { return {
  appendAuditEvent: ({ id, type, subjectId, actorId = null, actorLabel = 'user', detail = '{}' }) => query(databaseUrl, `insert into audit_event (id,type,subject_id,actor_id,actor_label,detail) values (${uuid(id)},${text(type)},${text(subjectId)},${nullable(uuid, actorId)},${text(actorLabel)},${text(detail)}::jsonb);`),
  listRecentAuditEvents: (limit) => many(databaseUrl, `select row_to_json(a) from (select id,type,subject_id as "subjectId",actor_id as "actorId",actor_label as "actorLabel",created_at as "createdAt",detail from audit_event order by created_at desc limit ${int(limit)}) a;`),
}; }
