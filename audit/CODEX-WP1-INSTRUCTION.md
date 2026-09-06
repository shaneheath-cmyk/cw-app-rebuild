# Codex instruction — WP-1: retire `cw_runtime_state`, conform to `001_initial.sql`

Issued 2026-09-06 · Baseline `e100282` on `remediation/wp-0-postgres-transport`
**This document supersedes WP-1 in `audit/WBS-CODEX-REMEDIATION.md`.** That section told you to
create a new `cw_*` table set. That was wrong: `db/migrations/001_initial.sql` already defines
the target schema and it is already applied in production. Do not create a parallel schema.
Conform to `001`. Everything else in the WBS stands.

---

## Operating rules

- **Do not stop to ask.** Every fork below is resolved in §2. If you hit one that is not covered,
  choose the option preserving the invariants, implement it, record it in `docs/DECISIONS.md`,
  and continue. Only the two escalations named in WBS §"Escalate to Shane" may halt you.
- **Invariants:** I1 zero runtime dependencies (no `dependencies` block in `package.json`);
  I2 nothing sensitive in argv, SQL travels on stdin; I3 no unbounded array serialised as one
  value; I4 fail closed; I5 keep the loopback binding.
- **Never weaken or delete an existing test to go green.** Fix the code. If a test is genuinely
  wrong, say so explicitly in the commit body.
- Ends green: `npm test && npm run check:legacy-free && npm run build`.
- One commit, message `WP-1 Move application state onto the relational schema`.

---

## 1. First action — confirm WP-0 on the node

```bash
cd /opt/cw-app && DATABASE_URL="$(grep -oP '(?<=^DATABASE_URL=).*' /etc/cw-app/cw-app.env)" \
  node scripts/verify-transport.mjs
```

Must print `PASS`. If it prints `INCONCLUSIVE`, stop and report — the transport WP-1 depends on
is unproven. Deploying WP-0 and seeing `/api/health` return `ok` does **not** substitute: that
statement is small enough that the replaced `-c` transport would have carried it too.

---

## 2. Resolved decisions

**F1 — Identifier types.** The app mints `user-<uuid>`, `deposit-<uuid>`, `task-<uuid>`,
`order-<uuid>`, `entitlement-<uuid>`, `parse-<uuid>`. `001` declares these columns `uuid`.
**Strip the prefixes. Store bare UUIDs. Leave `001`'s column types unchanged.** The prefixes were
an artefact of the JSON store, where every id shared one namespace; with real tables they carry no
information. Ids in API responses become bare UUIDs. This is a breaking change to id format and it
costs nothing today (empty catalogue, one bootstrap user) and more every week — do it now.
*Rejected:* widening the columns to `text` — discards uuid validation and index efficiency to
preserve cosmetics.

**F2 — Audit actor.** `audit_event.actor_id uuid references app_user(id)` cannot hold the app's
`'system'` and `'stripe-webhook'` actors; writing them violates the FK. Add
`actor_label text not null default 'user'` in `003`. Machine actors: `actor_id` null,
`actor_label` `'system'` or `'stripe-webhook'`. Human actors: `actor_id` set, label `'user'`.
**Do not relax the foreign key.**

**F3 — Duplicate deposits.** `001` has `unique (sha256)` on `source_deposit`; the current code
happily stores byte-identical deposits. **Keep the constraint.** This is a custody system —
duplicate-content detection is a feature. Catch the unique violation and raise
`An identical source artifact has already been deposited.` Add it to the WP-3 status map as `409`.

**F4 — Missing tables.** `001` has no home for the catalogue, the parse proposal, or sessions.
Add them in `003_relational_gaps.sql` (below). Nothing else.

**F5 — Sessions land in WP-1, not WP-2.** The app cannot serve a request without them, so WP-1
creates `user_session` and stores `token_hash` (SHA-256 of the token) — **never the token**.
WP-2 shrinks to rotation, expiry policy and pruning.

**F6 — Array values.** Emit as `array[$tag$a$tag$, $tag$b$tag$]::text[]`, never as a
`'{...}'` array literal. Sidesteps array-literal escaping entirely.

---

## 3. `db/migrations/003_relational_gaps.sql`

Additive only. Do not alter or drop anything from `001`.

```sql
alter table audit_event add column actor_label text not null default 'user';

create table catalogue_work (
  id uuid primary key,
  title text not null,
  author text not null,
  status text not null check (status in ('draft', 'editorial', 'production', 'released')),
  formats text[] not null default '{}',
  digital_product_code text not null default '',
  kdp_url text not null default '',
  hardcover_display_price_cents integer not null default 0 check (hardcover_display_price_cents >= 0),
  created_at timestamptz not null default now()
);

create table deposit_parse (
  id uuid primary key,
  deposit_id uuid not null unique references source_deposit(id),
  word_count integer not null check (word_count >= 0),
  headings text[] not null default '{}',
  suggested_title text not null default '',
  suggested_author text not null default '',
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  actor_id uuid references app_user(id),
  created_at timestamptz not null default now()
);

create table user_session (
  token_hash char(64) primary key,
  user_id uuid not null references app_user(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index user_session_expiry_idx on user_session(expires_at);
create index audit_event_recent_idx on audit_event(created_at desc);
create index catalogue_work_status_idx on catalogue_work(status);
```

Write `004_drop_runtime_state.sql` (`drop table cw_runtime_state;`) in this package but **do not
apply it** until WP-7 signs off that WP-1 is stable in production.

---

## 4. `src/lib/sql.js` (new)

Replaces `sqlLiteral`, which escapes only `'` and is therefore correct only while
`standard_conforming_strings` is on.

- `text(value)` → dollar-quoted with a per-value random tag: `'v' + randomBytes(8).toString('hex')`.
  **Assert the tag delimiter does not occur in the value**; regenerate if it does.
- `uuid(v)` — assert it matches the UUID pattern, emit bare-quoted.
- `int(v)` — assert `Number.isSafeInteger`, emit unquoted.
- `timestamp(v)` — assert ISO-8601, emit `text(v)::timestamptz`.
- `textArray(values)` — per F6.
- `nullable(fn, v)` — emits `null` or delegates.

Every emitter **throws on a type it does not expect**. No emitter accepts an arbitrary object.
Delete `sqlLiteral` from `postgres.js`; `grep -rn sqlLiteral src/` must come back empty.

---

## 5. Repositories — `src/lib/repositories/`

One module per aggregate: `users.js`, `sessions.js`, `deposits.js`, `tasks.js`, `works.js`,
`commerce.js`, `audit.js`. Each takes `databaseUrl` and exposes intention-revealing methods
(`findUserByEmail`, `insertUser`, `findSessionByTokenHash`, `insertDeposit`,
`markDepositRetrieved`, `replaceDepositParse`, `listOpenTasks`, `recordStripeEvent`,
`insertOrderWithEntitlement`, `appendAuditEvent`, `listRecentAuditEvents(limit)`).

**No method returns a whole table** except `listRecentAuditEvents(limit)`, which must carry an
explicit `limit` and `order by created_at desc`. `/api/operations` currently does
`auditEvents.slice(-30)` in JavaScript after loading everything — that becomes `limit 30` in SQL.

Delete `PostgresStore`. `FileStore` stays for development only and must satisfy the same
repository interface, so the two paths cannot drift.

**Batch each logical operation into one transaction and therefore one `psql` invocation** —
`begin; …; commit;` in a single stdin payload. A typical authenticated request should be two
spawns: one to authenticate, one for the operation. **If any request exceeds three, stop and
escalate to Shane** per the WBS: at that volume the subprocess model is untenable and invariant
I1 has to be re-argued. Record the measured count in `docs/DECISIONS.md` either way.

---

## 6. Concurrency — this is the part that must not be hand-waved

`retrieveDeposit` and `parseRetrievedDeposit` currently read, check status in JavaScript, then
write. Two callers can both pass the check. Replace with a conditional update inside the
transaction:

```sql
update source_deposit
   set status = 'retrieved', retrieved_at = now(), retrieved_by = <uuid>
 where id = <uuid> and status = 'staged'
```

Assert exactly one row was affected (`-A -t` with `returning id`, then count the output lines).
Zero rows means another actor won the race — raise
`Deposit is no longer in the required state.` Do **not** re-read and retry.

---

## 7. Tests to add

1. Two concurrent `retrieveDeposit` calls on one deposit: exactly one resolves, one raises the
   race error, and exactly one `editorial_task` row exists afterwards.
2. A second deposit with identical content raises the F3 duplicate error.
3. `appendAuditEvent` with actor `'system'` stores `actor_id` null and `actor_label` `'system'`,
   and does not violate the FK.
4. `sql.text` on a value containing a dollar-quote delimiter still round-trips.
5. Every `sql.*` emitter throws on a wrong-typed input.
6. `listRecentAuditEvents(30)` issues SQL containing `limit 30` — assert the generated statement,
   not just the result count.

Tests 1–3 need PostgreSQL. Gate them on `DATABASE_URL` being set and **skip loudly**
(`t.skip('requires DATABASE_URL')`) rather than silently passing when it is absent.

---

## 8. Acceptance

```bash
npm test && npm run check:legacy-free && npm run build
grep -rn "cw_runtime_state" src/    # must be empty
grep -rn "sqlLiteral" src/          # must be empty
grep -rn "PostgresStore" src/       # must be empty
```

On the node, after `npm run db:migrate` and a restart:

- `/api/health` → `{"status":"ok","store":"postgresql",...}`
- `/api/library` → `{"works":[]}`
- Sign in as the bootstrap admin, then
  `select count(*) from user_session;` → 1, and
  `select token_hash from user_session;` **must not equal the `cw_session` cookie value.**
- `select count(*) from cw_runtime_state;` still returns a row — `004` is deliberately unapplied.

Report the per-request `psql` spawn count with the completion.
