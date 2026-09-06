import { runPsql } from '../postgres.js';

export function query(databaseUrl, sql, tuplesOnly = false) { return runPsql({ databaseUrl, sql, tuplesOnly }); }
export async function one(databaseUrl, sql) { const output = await query(databaseUrl, sql, true); return output ? JSON.parse(output) : null; }
export async function many(databaseUrl, sql) { const output = await query(databaseUrl, sql, true); return output ? output.split('\n').filter(Boolean).map(JSON.parse) : []; }
