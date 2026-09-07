import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const zones = ['01-staging', '02-source-vault', '03-editorial', '04-production', '05-release', '06-archive'];

export function checksum(value) {
  return createHash('sha256').update(value).digest('hex');
}

function safeFilename(name) {
  const clean = String(name || 'untitled.txt').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return clean || 'untitled.txt';
}

export async function createDeposit({ storageRoot, store, submittedBy, filename, content, declaredRights, intendedTitle, intendedAuthor }) {
  if (!content || typeof content !== 'string') throw new Error('A textual source artifact is required.');
  if (Buffer.byteLength(content, 'utf8') > 5 * 1024 * 1024) throw new Error('Source artifact exceeds the 5 MB textual intake limit.');
  if (!declaredRights) throw new Error('Declared rights are required before deposit.');

  const depositId = randomUUID();
  const artifactName = safeFilename(filename);
  const stagingDirectory = resolve(storageRoot, '01-staging', depositId);
  const permittedRoot = resolve(storageRoot, '01-staging');
  if (!stagingDirectory.startsWith(permittedRoot)) throw new Error('Invalid storage path.');

  await mkdir(stagingDirectory, { recursive: true });
  const artifactPath = join(stagingDirectory, artifactName);
  await writeFile(artifactPath, content, { flag: 'wx' });
  const sha256 = checksum(content);
  const deposit = {
    id: depositId,
    status: 'staged',
    submittedBy,
    filename: artifactName,
    sha256,
    declaredRights,
    intendedTitle: intendedTitle || '',
    intendedAuthor: intendedAuthor || '',
    createdAt: new Date().toISOString(),
  };

  try {
    if (store.insertDeposit) {
      await store.insertDeposit(deposit);
      await store.appendAuditEvent({ id: randomUUID(), type: 'deposit.staged', subjectId: deposit.id, actorId: submittedBy });
    } else await store.update((state) => {
      state.deposits.push(deposit);
      state.auditEvents.push({ id: randomUUID(), type: 'deposit.staged', subjectId: deposit.id, at: deposit.createdAt, actor: submittedBy });
    });
  } catch (error) {
    await rm(artifactPath, { force: true });
    throw error;
  }
  return deposit;
}

export async function retrieveDeposit({ store, depositId, actor }) {
  if (store.retrieveDeposit) return store.retrieveDeposit({ depositId, actor });
  return store.update((state) => {
    const deposit = state.deposits.find((item) => item.id === depositId);
    if (!deposit) throw new Error('Deposit not found.');
    if (deposit.status !== 'staged') throw new Error('Only staged deposits can be retrieved.');
    deposit.status = 'retrieved';
    deposit.retrievedAt = new Date().toISOString();
    deposit.retrievedBy = actor;
    const task = { id: `task-${randomUUID()}`, type: 'intake-review', status: 'open', depositId, assigneeRole: 'literary-custodian', createdAt: deposit.retrievedAt };
    state.tasks.push(task);
    state.auditEvents.push({ id: randomUUID(), type: 'deposit.retrieved', subjectId: deposit.id, at: deposit.retrievedAt, actor });
    return { deposit, task };
  });
}

export async function parseRetrievedDeposit({ storageRoot, store, depositId, actor }) {
  if (store.findDeposit) {
    const deposit = await store.findDeposit(depositId);
    if (!deposit) throw new Error('Deposit not found.');
    if (deposit.status !== 'retrieved') throw new Error('Only retrieved deposits can be parsed.');
    const content = await readFile(join(resolve(storageRoot, '01-staging', deposit.id), deposit.filename), 'utf8');
    const headings = content.split(/\r?\n/).map((line) => line.trim().slice(0, 200)).filter((line) => /^(chapter|part|prologue|epilogue)\b/i.test(line)).slice(0, 100);
    const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
    return store.replaceDepositParse({ id: randomUUID(), depositId, wordCount, headings, suggestedTitle: deposit.intendedTitle, suggestedAuthor: deposit.intendedAuthor, confidence: deposit.intendedTitle && deposit.intendedAuthor ? 'medium' : 'low', createdAt: new Date().toISOString(), actor });
  }
  const state = await store.read();
  const deposit = state.deposits.find((item) => item.id === depositId);
  if (!deposit) throw new Error('Deposit not found.');
  if (deposit.status !== 'retrieved') throw new Error('Only retrieved deposits can be parsed.');
  const sourcePath = join(resolve(storageRoot, '01-staging', deposit.id), deposit.filename);
  const content = await readFile(sourcePath, 'utf8');
  const headings = content.split(/\r?\n/).map((line) => line.trim().slice(0, 200)).filter((line) => /^(chapter|part|prologue|epilogue)\b/i.test(line)).slice(0, 100);
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const proposal = { id: `parse-${randomUUID()}`, depositId, wordCount: words, headings, suggestedTitle: deposit.intendedTitle, suggestedAuthor: deposit.intendedAuthor, confidence: deposit.intendedTitle && deposit.intendedAuthor ? 'medium' : 'low', createdAt: new Date().toISOString(), actor };

  return store.update((next) => {
    const current = next.deposits.find((item) => item.id === depositId);
    current.status = 'parsed';
    current.parse = proposal;
    next.tasks.push({ id: `task-${randomUUID()}`, type: 'catalogue-approval', status: 'open', depositId, assigneeRole: 'literary-custodian', createdAt: proposal.createdAt });
    next.auditEvents.push({ id: randomUUID(), type: 'deposit.parsed', subjectId: depositId, at: proposal.createdAt, actor });
    return proposal;
  });
}

export { zones };
