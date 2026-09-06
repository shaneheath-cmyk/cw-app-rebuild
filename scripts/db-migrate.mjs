import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runPsql, verifyPostgresRuntime } from '../src/lib/postgres.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required to apply migrations.');
const migrationDirectory = join(process.cwd(), 'db', 'migrations');
const migrations = (await readdir(migrationDirectory)).filter((name) => /^00[1-3]_.+\.sql$/.test(name)).sort();

await runPsql({ databaseUrl, sql: 'create table if not exists cw_schema_migration (name text primary key, applied_at timestamptz not null default now());' });
const applied = new Set((await runPsql({ databaseUrl, tuplesOnly: true, sql: 'select name from cw_schema_migration order by name;' })).split('\n').filter(Boolean));
const legacyInitialSchemaExists = await runPsql({ databaseUrl, tuplesOnly: true, sql: "select to_regclass('public.app_user') is not null;" });
if (!applied.size && legacyInitialSchemaExists === 't') {
  await runPsql({ databaseUrl, sql: "insert into cw_schema_migration (name) values ('001_initial.sql');" });
  applied.add('001_initial.sql');
  console.log('Recorded existing 001_initial.sql baseline.');
}
for (const name of migrations) {
  if (applied.has(name)) continue;
  const sql = await readFile(join(migrationDirectory, name), 'utf8');
  await runPsql({ databaseUrl, sql: `begin; ${sql}\ninsert into cw_schema_migration (name) values ('${name.replaceAll("'", "''")}'); commit;` });
  console.log(`Applied ${name}`);
}
console.log(`PostgreSQL runtime verified as ${await verifyPostgresRuntime(databaseUrl)}`);
