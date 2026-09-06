import { many } from './base.js';
export function tasks(databaseUrl) { return { listOpenTasks: () => many(databaseUrl, "select row_to_json(t) from (select id,deposit_id as \"depositId\",type,status,assignee_role as \"assigneeRole\",created_at as \"createdAt\" from editorial_task where status in ('open','in_progress') order by created_at asc) t;") }; }
