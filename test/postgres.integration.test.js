import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRepositories } from '../src/lib/repositories/index.js';
import { runPsql } from '../src/lib/postgres.js';
import { uuid } from '../src/lib/sql.js';

const databaseUrl = process.env.DATABASE_URL;

test('PostgreSQL enforces duplicate custody, conditional retrieval, and machine audit actors', { skip: !databaseUrl && 'requires DATABASE_URL' }, async () => {
  const repositories = createRepositories(databaseUrl);
  const userId = randomUUID();
  await repositories.insertUser({ id: userId, email: `integration-${randomUUID()}@example.test`, passwordHash: 'test-hash', roles: ['system-admin'], createdAt: new Date().toISOString() });
  const deposit = { id: randomUUID(), submittedBy: userId, filename: 'race.txt', sha256: 'a'.repeat(64), declaredRights: 'integration test', intendedTitle: '', intendedAuthor: '', createdAt: new Date().toISOString() };
  await repositories.insertDeposit(deposit);
  await assert.rejects(() => repositories.insertDeposit({ ...deposit, id: randomUUID() }), /identical source artifact/);

  const attempts = await Promise.allSettled([
    repositories.retrieveDeposit({ depositId: deposit.id, actor: userId }),
    repositories.retrieveDeposit({ depositId: deposit.id, actor: userId }),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === 'rejected' && /no longer in the required state/.test(attempt.reason.message)).length, 1);
  const taskCount = await runPsql({ databaseUrl, tuplesOnly: true, sql: `select count(*) from editorial_task where deposit_id=${uuid(deposit.id)} and type='intake-review';` });
  assert.equal(Number(taskCount), 1, 'exactly one intake task exists after concurrent retrieval');

  await repositories.replaceDepositParse({ id: randomUUID(), depositId: deposit.id, wordCount: 2, headings: ['Chapter One'], suggestedTitle: 'Race proof', suggestedAuthor: 'Integration', confidence: 'medium', actor: userId, createdAt: new Date().toISOString() });
  const operations = await repositories.listForOperations(1);
  assert.equal(operations.length, 1, 'operations query honors its explicit limit');
  assert.equal(operations[0].id, deposit.id);
  assert.equal(operations[0].parse.suggestedTitle, 'Race proof', 'operations joins the deposit parse record');

  const auditId = randomUUID();
  await repositories.appendAuditEvent({ id: auditId, type: 'integration.system', subjectId: deposit.id, actorLabel: 'system' });
  const actor = await runPsql({ databaseUrl, tuplesOnly: true, sql: `select coalesce(actor_id::text,'null') || ':' || actor_label from audit_event where id=${uuid(auditId)};` });
  assert.equal(actor, 'null:system');
  const recent = await repositories.listRecentAuditEvents(30);
  assert.ok(recent.length <= 30);
});
