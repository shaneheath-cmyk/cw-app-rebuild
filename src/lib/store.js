import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const emptyState = {
  works: [
    {
      id: 'work-beneath-black-trees',
      title: 'Beneath the Black Trees',
      author: 'Collective Writings',
      status: 'editorial',
      formats: ['ebook', 'audiobook', 'hardcover'],
      digitalProductCode: 'title-beneath-black-trees-digital',
      kdpUrl: '',
      hardcoverDisplayPrice: 3495,
    },
  ],
  deposits: [],
  tasks: [],
  orders: [],
  entitlements: [],
  stripeEvents: [],
  auditEvents: [],
  users: [],
  sessions: [],
};

export class FileStore {
  constructor(dataDirectory) {
    this.path = join(dataDirectory, 'cw-store.json');
    this.dataDirectory = dataDirectory;
    this.queue = Promise.resolve();
  }

  async initialise() {
    await mkdir(this.dataDirectory, { recursive: true });
    try {
      await readFile(this.path, 'utf8');
    } catch {
      await writeFile(this.path, JSON.stringify(emptyState, null, 2), 'utf8');
    }
  }

  async read() {
    await this.initialise();
    const state = JSON.parse(await readFile(this.path, 'utf8'));
    for (const [key, value] of Object.entries(emptyState)) if (!Array.isArray(state[key])) state[key] = value;
    return state;
  }

  async update(mutator) {
    const operation = this.queue.then(async () => {
      const state = await this.read();
      const result = await mutator(state);
      await writeFile(this.path, JSON.stringify(state, null, 2), 'utf8');
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async findUserByEmail(email) { return (await this.read()).users.find((user) => user.email === email) || null; }
  async countUsers() { return (await this.read()).users.length; }
  async insertUser(user) { await this.update((state) => state.users.push(user)); return user; }
  async findSessionByTokenHash(tokenHash) { const state = await this.read(); const session = state.sessions.find((item) => item.tokenHash === tokenHash && new Date(item.expiresAt) > new Date()); const user = session && state.users.find((item) => item.id === session.userId); return user || null; }
  async insertSession(session) { await this.update((state) => state.sessions.push(session)); }
  async deleteSession(tokenHash) { await this.update((state) => { state.sessions = state.sessions.filter((item) => item.tokenHash !== tokenHash); }); }
  async pruneSessions() { await this.update((state) => { state.sessions = state.sessions.filter((item) => new Date(item.expiresAt) > new Date()); }); }
  async listWorks() { return (await this.read()).works; }
  async listOpenTasks() { return (await this.read()).tasks.filter((task) => ['open', 'in_progress'].includes(task.status)); }
  async appendAuditEvent(event) { await this.update((state) => state.auditEvents.push(event)); }
  async listRecentAuditEvents(limit) { return (await this.read()).auditEvents.slice(-limit).reverse(); }
  async insertDeposit(deposit) { await this.update((state) => { if (state.deposits.some((item) => item.sha256 === deposit.sha256)) throw new Error('An identical source artifact has already been deposited.'); state.deposits.push(deposit); }); return deposit; }
  async findDeposit(id) { return (await this.read()).deposits.find((deposit) => deposit.id === id) || null; }
  async retrieveDeposit({ depositId, actor }) { return this.update((state) => { const deposit = state.deposits.find((item) => item.id === depositId); if (!deposit || deposit.status !== 'staged') throw new Error('Deposit is no longer in the required state.'); deposit.status = 'retrieved'; deposit.retrievedAt = new Date().toISOString(); deposit.retrievedBy = actor; const task = { id: randomUUID(), depositId, type: 'intake-review', status: 'open', assigneeRole: 'literary-custodian', createdAt: deposit.retrievedAt }; state.tasks.push(task); return { deposit, task }; }); }
  async replaceDepositParse(proposal) { return this.update((state) => { const deposit = state.deposits.find((item) => item.id === proposal.depositId); if (!deposit || deposit.status !== 'retrieved') throw new Error('Deposit is no longer in the required state.'); deposit.status = 'parsed'; deposit.parse = proposal; state.tasks.push({ id: randomUUID(), depositId: proposal.depositId, type: 'catalogue-approval', status: 'open', assigneeRole: 'literary-custodian', createdAt: proposal.createdAt }); return proposal; }); }
}
