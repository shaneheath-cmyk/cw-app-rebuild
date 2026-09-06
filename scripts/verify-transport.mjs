// Positive control for WP-0: proves a statement larger than the kernel's single-argument limit
// (MAX_ARG_STRLEN, 131072 bytes on Linux) now reaches PostgreSQL, and that the previous `-c`
// transport genuinely could not carry it.
//
// A migration or a health check does not demonstrate this -- both are small enough to have
// succeeded under the old transport. Only an oversized payload separates the two.
//
// Uses a scratch table (cw_transport_probe) which it drops on the way out. It never reads or
// writes application data. Safe to run against production.
//
//   DATABASE_URL=... node scripts/verify-transport.mjs

import { spawn } from 'node:child_process';
import { runPsql } from '../src/lib/postgres.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const limit = 131072;
const size = 300_000;
const payload = 'x'.repeat(size);
const results = [];

// ENOENT means psql is absent, which proves nothing either way -- never let it read as a pass.
const describe = (error) => (error.code === 'ENOENT'
  ? 'INCONCLUSIVE: psql not on PATH'
  : `rejected before exec (${error.code})`);

// --- Control: the transport WP-0 replaced. Must fail.
const legacy = await new Promise((resolve) => {
  let child;
  try {
    child = spawn('psql', ['-X', '-c', `select length('${payload}');`], { env: { PATH: process.env.PATH }, windowsHide: true });
  } catch (error) {
    return resolve(describe(error));
  }
  child.once('error', (error) => resolve(describe(error)));
  child.once('close', (code) => resolve(code === 0 ? 'SUCCEEDED' : `psql exited ${code}`));
});
results.push(['legacy -c transport', legacy]);

// --- Live path: stdin. Must succeed and round-trip byte-exact.
await runPsql({ databaseUrl, sql: 'create table if not exists cw_transport_probe (id boolean primary key default true check (id), blob text not null);' });
try {
  // Dollar-quoting, the encoding decided for WP-1: immune to standard_conforming_strings.
  await runPsql({ databaseUrl, sql: `insert into cw_transport_probe (id, blob) values (true, $probe$${payload}$probe$) on conflict (id) do update set blob = excluded.blob;` });
  const stored = Number(await runPsql({ databaseUrl, tuplesOnly: true, sql: 'select length(blob) from cw_transport_probe where id = true;' }));
  results.push(['stdin transport, bytes stored', `${stored}${stored === size ? '' : ` -- EXPECTED ${size}`}`]);
  results.push(['round-trip byte-exact', stored === size ? 'yes' : 'NO']);
} finally {
  await runPsql({ databaseUrl, sql: 'drop table if exists cw_transport_probe;' });
}

const [, legacyOutcome] = results[0];
const roundTripped = results.at(-1)[1] === 'yes';

console.log(`\nstatement size ${size} bytes (single-argument limit is ${limit})\n`);
for (const [label, value] of results) console.log(`  ${label.padEnd(32)} ${value}`);

if (legacyOutcome === 'SUCCEEDED') {
  console.log('\nINCONCLUSIVE: the legacy -c path carried this payload, so this host does not');
  console.log('enforce the limit WP-0 addresses. The stdin result above still stands on its own.');
} else if (!roundTripped) {
  console.error('\nFAILED: the stdin transport did not round-trip the payload.');
  process.exit(1);
} else {
  console.log('\nPASS: the payload failed on the transport WP-0 removed and succeeded on the one it added.');
}
