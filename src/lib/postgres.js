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
    // SQL is delivered on stdin, never as an argv element. Passing it via `-c` capped every
    // statement at the kernel's single-argument limit (MAX_ARG_STRLEN, 131072 bytes on Linux)
    // and published the payload — session tokens and password hashes included — to any local
    // account able to read /proc/<pid>/cmdline or run ps.
    const args = ['-X', '-q', '-v', 'ON_ERROR_STOP=1'];
    if (tuplesOnly) args.push('-A', '-t');
    args.push('-f', '-');
    const child = spawn('psql', args, { env: { PATH: process.env.PATH, ...connection }, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let failed = false;
    const fail = (error) => { if (!failed) { failed = true; reject(error); } };
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => fail(new Error(`PostgreSQL client could not start: ${error.message}`)));
    // A psql that exits before consuming the payload raises EPIPE on the write side; report the
    // process failure rather than an unhandled stream error.
    child.stdin.on('error', () => {});
    child.once('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else fail(new Error(`PostgreSQL command failed: ${stderr.trim() || `exit ${code}`}`));
    });
    child.stdin.end(sql, 'utf8');
  });
}

export async function verifyPostgresRuntime(databaseUrl) {
  const identity = await runPsql({ databaseUrl, tuplesOnly: true, sql: 'select current_user || \' : \' || current_database();' });
  if (!identity) throw new Error('PostgreSQL identity verification returned no result.');
  return identity.replace(/\s+/g, '');
}
