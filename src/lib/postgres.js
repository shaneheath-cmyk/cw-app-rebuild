import { spawn } from 'node:child_process';

function connectionEnvironment(databaseUrl) {
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use a PostgreSQL URL.');
  if (!url.hostname || !url.pathname || !url.username || !url.password) throw new Error('DATABASE_URL is missing PostgreSQL connection details.');
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
}

export function runPsql({ databaseUrl, sql, tuplesOnly = false }) {
  const connection = connectionEnvironment(databaseUrl);
  return new Promise((resolve, reject) => {
    const args = ['-X', '-v', 'ON_ERROR_STOP=1'];
    if (tuplesOnly) args.push('-A', '-t');
    args.push('-c', sql);
    const child = spawn('psql', args, { env: { PATH: process.env.PATH, ...connection }, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => reject(new Error(`PostgreSQL client could not start: ${error.message}`)));
    child.once('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`PostgreSQL command failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export async function verifyPostgresRuntime(databaseUrl) {
  const identity = await runPsql({ databaseUrl, tuplesOnly: true, sql: 'select current_user || \' : \' || current_database();' });
  if (!identity) throw new Error('PostgreSQL identity verification returned no result.');
  return identity.replace(/\s+/g, '');
}

export class PostgresStore {
  constructor(databaseUrl, emptyState) {
    this.databaseUrl = databaseUrl;
    this.emptyState = emptyState;
    this.queue = Promise.resolve();
  }

  async initialise() {
    const exists = await runPsql({ databaseUrl: this.databaseUrl, tuplesOnly: true, sql: "select to_regclass('public.cw_runtime_state') is not null;" });
    if (exists !== 't') throw new Error('PostgreSQL runtime state is missing. Run npm run db:migrate before starting the application.');
    const state = await this.read();
    if (!state) await this.write(this.emptyState);
  }

  async read() {
    const output = await runPsql({ databaseUrl: this.databaseUrl, tuplesOnly: true, sql: 'select state::text from cw_runtime_state where id = true;' });
    if (!output) return null;
    return JSON.parse(output);
  }

  async write(state) {
    const payload = sqlLiteral(JSON.stringify(state));
    await runPsql({ databaseUrl: this.databaseUrl, sql: `insert into cw_runtime_state (id, state, updated_at) values (true, ${payload}::jsonb, now()) on conflict (id) do update set state = excluded.state, updated_at = now();` });
  }

  async update(mutator) {
    const operation = this.queue.then(async () => {
      let state = await this.read();
      if (!state) state = structuredClone(this.emptyState);
      const result = await mutator(state);
      await this.write(state);
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
