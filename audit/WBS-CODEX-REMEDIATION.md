# WBS — Collective Writings standalone remediation

Author: Claude (Opus 5) · Issued 2026-09-06 · Baseline commit `66c87ef` + uncommitted WP-0
Source of findings: `audit/CLAUDE-ADVERSARIAL-VERDICT.md`
Executor: Codex

---

## 0. Operating rules for this WBS

1. **Do not halt to ask questions.** Every fork in this document is already resolved. Where an
   alternative exists it is recorded under *Rejected* — it is recorded so you do not re-open it,
   not so you can choose it. If you hit a fork this document genuinely does not cover, pick the
   option that preserves the invariants in §0.4, implement it, and record the decision in
   `docs/DECISIONS.md` with a one-paragraph rationale. Keep going.
2. **One work package per commit.** Commit message: `WP-<n> <imperative summary>`. Do not batch.
3. **Every work package ends green**: `npm test`, `npm run check:legacy-free`, `npm run build`.
   A package is not complete until all three pass. Never weaken or delete an existing test to
   make a package pass — if an existing test is genuinely wrong, fix the code, and if the test
   itself is wrong say so explicitly in the commit body.
4. **Invariants that must hold after every package** (these are the tie-breakers):
   - **I1** Zero external runtime dependencies. `package.json` has no `dependencies` block.
     Dev-only tooling is likewise prohibited unless a package below names it.
   - **I2** No SQL statement, credential, session token, or password hash ever appears in a
     process argument list. Values reach PostgreSQL on stdin only.
   - **I3** No unbounded array is serialised as a single value.
   - **I4** The service fails closed: any missing or invalid production configuration is a
     start-up error, never a silent downgrade.
   - **I5** `127.0.0.1` binding is retained until WP-8 lands the reverse proxy.
5. **Acceptance criteria are machine-checkable.** Each package states the exact command that
   proves it. Add the test that makes that command meaningful; do not assert by inspection.
6. **Do not touch** `audit/*.md` — they are the review record.

---

## WP-0 — Already applied (do not redo)

Delivered by Claude on 2026-09-06, uncommitted in the working tree. Read it before starting WP-1.

| File | Change |
|---|---|
| `src/lib/postgres.js` | `runPsql` now sends SQL on **stdin** (`-f -`, plus `-q`) instead of `-c`. Removes the 131,072-byte `MAX_ARG_STRLEN` ceiling and stops leaking state through `/proc/<pid>/cmdline`. EPIPE on the write side is swallowed so the process exit code is the reported error. |
| `src/lib/config.js` | Added `nodeEnv`. |
| `src/server.js` | `createStore` throws when `NODE_ENV=production` and `DATABASE_URL` is unset, instead of falling back to `FileStore`. |
| `test/core.test.js` | Two tests added: the production fail-closed guard, and proof that a 200,000-byte statement transits stdin with 0 bytes in argv. |

**Known gap you must close in WP-1:** the stdin path was **not** exercised against a real
`psql` — none is installed on the review machine. Your first action in WP-1 is to run
`npm run db:migrate` and `curl localhost:4173/api/health` on pax-node-01 and confirm both still
work. If `-q` suppresses output that `db-migrate.mjs` parses, fix `db-migrate.mjs`, not the
transport. Note that migration files already contain their own `begin; … commit;`, so **never**
add psql's `-1` flag.

---

## WP-1 — Relational repositories (retire `cw_runtime_state`)

> **SUPERSEDED by `audit/CODEX-WP1-INSTRUCTION.md`. Follow that document, not this section.**
> This section specified a new `cw_*` table set. That was an error on my part: `001_initial.sql`
> already defines the target relational schema (`app_user`, `source_deposit`, `editorial_task`,
> `commerce_event`, `customer_order`, `entitlement`, `audit_event`) and it is already applied in
> production. `002` added the JSON blob *beside* it. WP-1 is therefore **conform to `001`**, not
> design a parallel schema. The "Why" below still holds; the design detail does not.

**Why:** the entire application state is one JSON document, read and rewritten in full on every
request. WP-0 removed the hard ceiling; it did not remove the read-modify-write cycle, the
absence of cross-process locking, or the O(state) cost per call. A second instance, or an
overlapping restart, silently clobbers writes.

**Decided design — implement exactly this:**

- New migration `db/migrations/003_relational_core.sql`. Tables, all with `id text primary key`:
  `cw_user` (email `citext`-style lower-cased text, `unique`), `cw_session`, `cw_work`,
  `cw_deposit`, `cw_deposit_parse`, `cw_task`, `cw_order`, `cw_entitlement`,
  `cw_stripe_event` (`id` = Stripe event id, the idempotency key), `cw_audit_event`.
- Foreign keys with `on delete restrict`. Indexes on every column used in a lookup:
  `cw_session(token_hash)`, `cw_audit_event(at desc)`, `cw_deposit(status)`,
  `cw_order(stripe_session_id)`.
- **Do not migrate data.** The production catalogue is empty and the only rows are one bootstrap
  user and its audit event. `003` creates tables; a fresh bootstrap repopulates. Drop
  `cw_runtime_state` in a separate migration `004_drop_runtime_state.sql` only after WP-1 is
  verified in production — `004` is written in WP-1 but **not** applied until WP-7 signs off.
- Replace `PostgresStore.{read,write,update}` with a repository per aggregate
  (`src/lib/repositories/*.js`), each exposing intention-revealing methods
  (`findUserByEmail`, `insertDeposit`, `markDepositRetrieved`, …). No method returns whole-table
  contents except `listRecentAuditEvents(limit)`.
- Multi-statement operations wrap in `begin; … commit;` in the stdin payload.
- **Concurrency:** `retrieveDeposit` and `parseRetrievedDeposit` must use
  `select … for update` inside the transaction, and the status check must be part of the
  `update … where status = '<expected>'` predicate. Assert `rowcount = 1`; a 0 means another
  actor won the race — surface `Deposit is no longer in the required state.`
- **Value escaping — decided:** dollar-quoting with a per-value random tag.
  Generate `const tag = 'v' + randomBytes(8).toString('hex')`, assert the literal
  `$${tag}$` does not occur in the value, and emit `$${tag}$<value>$${tag}$`. This is immune to
  `standard_conforming_strings` being off, which the current `sqlLiteral` is not. Delete
  `sqlLiteral`. `null`, numbers and booleans are emitted as bare tokens after type assertion —
  never quoted-then-cast.
  - *Rejected:* the `pg` npm client, which would give real bind parameters and pooling but
    breaks **I1** (zero runtime dependencies), the stated point of this rebuild. **Escalate to
    Shane, do not decide yourself, if — and only if — WP-1 profiling shows more than 3 `psql`
    subprocesses per request**; at that volume the subprocess model is untenable and I1 has to
    be re-argued. Record the measurement in `docs/DECISIONS.md` either way.
  - *Rejected:* `psql -v` variables — that is argv again, violating **I2**.

**Acceptance:**
```
npm test                       # new: two concurrent retrieveDeposit calls, exactly one succeeds
grep -rn "cw_runtime_state" src/   # must return nothing
grep -rn "sqlLiteral" src/         # must return nothing
```
Plus on-node: `npm run db:migrate && systemctl restart cw-app && curl -s localhost:4173/api/health`
returns `"store":"postgresql"`, and `/api/library` returns `{"works":[]}`.

---

## WP-2 — Session storage and token handling

- Sessions move to `cw_session`; **store `token_hash` (SHA-256 of the token), never the token.**
  A database read must not yield a usable credential.
- Look up by `token_hash`; compare with `timingSafeEqual`.
- `expires_at timestamptz not null`; expiry enforced in the `where` clause, not in JavaScript.
- Delete expired rows on every successful sign-in **and** add
  `delete from cw_session where expires_at < now()` to the WP-6 retention job.
- Rotate the session token on successful sign-in (issue new, delete the presenting one).

**Acceptance:** `npm test` — a test asserts that the value stored for a live session does not
equal the cookie value, and that a request bearing the stored value is rejected.

---

## WP-3 — Authentication response semantics

Three defects, all confirmed by probe:

| Symptom | Required behaviour |
|---|---|
| Invalid credentials → `422` | `401`, body `{"error":"Invalid email or password."}` |
| Expired/absent/unknown session → `403` | `401`. `403` is reserved for *authenticated but not permitted*. |
| Malformed cookie → `422 {"error":"URI malformed"}` | Treat an undecodable cookie as no session → `401`. |

- Fix `readCookies` (`src/lib/auth.js:32`): wrap `decodeURIComponent` per component in
  try/catch, skip components that throw. Do not let a stray `%` reach the caller.
- Split `currentActor` into `authenticate()` (throws `Authentication required.` → 401) and
  `authorise(user, permitted)` (throws `Forbidden.` → 403). The current single function conflates
  them, which is the root cause of row 2.
- Replace the status ladder in `server.js:124` with an explicit error-to-status map. Never return
  a raw `error.message` for a status the map does not know — return `Request failed.` and log
  the detail server-side.

**Acceptance:** `npm test` asserts all three rows above, and that no 5xx/422 is returned for any
combination of absent, malformed, unknown and expired cookie.

---

## WP-4 — Abuse controls

- **Login throttle.** Per-email and per-source-IP. Fixed policy: 5 failures in 15 minutes →
  reject with `429` and `Retry-After: 900` for that pair, regardless of credential validity.
  Counters live in a `cw_login_attempt` table (survives restart; an in-memory map does not).
  A successful sign-in clears the email counter.
- **`/api/checkout` requires an authenticated session** and is throttled to 10 per session per
  hour. It is currently reachable unauthenticated, which with live keys lets anyone mint
  unlimited Stripe sessions against the account.
- **Body limits.** `/api/webhooks/stripe` drops to 1 MB (Stripe events do not approach this);
  reject with `413` before reading the body when `content-length` exceeds the limit, rather than
  buffering to the limit and then throwing.
- Return `429`/`413` through the WP-3 status map.

**Acceptance:** `npm test` — the 6th failed login inside the window returns `429`; an
unauthenticated `POST /api/checkout` returns `401`; a 2 MB webhook body returns `413`.

---

## WP-5 — Correctness defects from the review

Small, independent, no design decisions. One commit is acceptable for the whole package.

1. `src/public/app.js:38` — the card renders `money(1495)` for every work. Read the price from
   the product/work record. **Do not ship a page that displays a price the checkout will not charge.**
2. `src/lib/store.js:47` — `state[key] = value` assigns the shared module-level `emptyState`
   arrays by reference. Use `structuredClone(value)`.
3. `src/lib/custody.js:78` — `parseRetrievedDeposit` re-finds the deposit after the read and
   dereferences it without a null check. Becomes moot if WP-1's `for update` predicate is in
   place; assert it explicitly regardless.
4. `src/lib/custody.js` — cap `parse.headings` at 100 entries **and 200 characters each**. It is
   attacker-controlled text written into durable storage with no length bound.
5. `src/server.js:6` — `verifyPostgresRuntime` is imported and never called. Either call it
   during `initialise()` and log the identity at boot (**do this**), or drop the import.
6. `createDeposit` writes the artefact to disk before the store update; a failed update orphans
   the file. Delete the file in a `catch` and rethrow.
7. `dist/` is built but never served — production runs `node src/server.js`, which serves
   `src/public` (`server.js:42`). Decide and enforce one: serve `dist/` in production and add it
   to the unit file's working set. Add a start-up assertion that the served directory exists.

**Acceptance:** `npm test && npm run build && npm run check:legacy-free`, plus a test per item
1, 2, 4 and 6.

---

## WP-6 — Retention

Nothing in the system is ever pruned. This is what detonated the original design and it will
degrade the relational one.

- `cw_audit_event`: retain 400 days. Before deletion, append to a monthly JSONL file under
  `${CW_STORAGE_ROOT}/06-archive/audit/`. **Audit history is evidentiary — archive, never
  silently discard.**
- `cw_stripe_event`: retain 90 days (well beyond Stripe's retry window).
- `cw_session`: delete on expiry.
- Implement as `scripts/retention.mjs` plus a systemd timer unit in `deploy/`. Not a `setInterval`
  inside the web process — it must be separately schedulable and separately observable.
- Idempotent, and safe to run concurrently with the service.

**Acceptance:** `node scripts/retention.mjs --dry-run` prints per-table counts and writes nothing;
a test seeds an over-age row and asserts it is archived then removed.

---

## WP-7 — Connection and deployment hardening

- **`connectionEnvironment` silently drops URL query parameters**, so a `DATABASE_URL` carrying
  `?sslmode=require` would connect **unencrypted**. Pass `PGSSLMODE` through from the URL;
  default to `require` for any non-loopback host, and refuse to start when a non-loopback host
  is combined with `sslmode=disable`.
- Validate config at boot and fail closed (**I4**): in production require `DATABASE_URL`,
  `CW_PUBLIC_ORIGIN` starting `https://`, and — if `STRIPE_SECRET_KEY` is set — both a webhook
  secret and every referenced `price_` id. Report **all** failures at once, not the first.
- Apply `004_drop_runtime_state.sql` once WP-1 is confirmed stable in production.
- Add `MemoryDenyWriteExecute=yes`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`,
  `PrivateDevices=yes`, `ProtectKernelTunables=yes`, `ProtectControlGroups=yes` to
  `deploy/cw-app.service`.

**Acceptance:** `npm test` — boot with each production variable missing in turn asserts a
start-up throw naming every offending variable.

---

## WP-8 — TLS and public origin

- Reverse proxy (nginx or Caddy) terminating TLS, proxying to `127.0.0.1:4173`. The app keeps its
  loopback binding (**I5**) — it is never directly exposed.
- HSTS `max-age=63072000; includeSubDomains` at the proxy. Add `upgrade-insecure-requests` to
  the CSP once TLS is live.
- **`CW_PUBLIC_ORIGIN` must become the real `https://` origin.** Today the unit file pins
  `http://127.0.0.1:4173`, which (a) strips `Secure` from the session cookie, because
  `secureCookie` is derived from that string, and (b) would send Stripe `success_url` /
  `cancel_url` pointing at 127.0.0.1. Both silently produce a broken production system.
- Add a start-up assertion: `NODE_ENV=production` and a non-`https://` `CW_PUBLIC_ORIGIN` is fatal.
- Commit the proxy config to `deploy/`; do not leave it as undocumented node state.

**Acceptance:** `curl -sI https://<origin>/` shows HSTS and the redirect from `http`; a login
against the deployed origin returns a `Set-Cookie` containing `Secure`.

---

## WP-9 — Fulfilment (gate for live Stripe)

**Do not switch `STRIPE_SECRET_KEY` to `sk_live_` until this package is complete.** Orders and
entitlements are currently written and read by nothing; there is no download route and no link
from an entitlement to an account. Taking payment in this state means taking money and
delivering nothing.

- Link `cw_entitlement` to `cw_user`. Resolve on `customer_details.email`; where no account
  exists, create a pending entitlement and an account-claim flow. Do not auto-create a
  password-less account.
- Authenticated delivery route serving from `05-release`, authorised by an active entitlement.
  Stream the file; never expose a storage path or a guessable URL.
- Record every delivery as an audit event.
- Replace the placeholder "My Library" copy in `src/public/app.js:61` with the real view.
- Then, and only then: live keys, live webhook secret, live price ids, and a real
  `checkout.session.completed` end-to-end against the deployed origin.

**Acceptance:** a test drives webhook → entitlement → authenticated download, and asserts that
the same download without the entitlement returns `403` and without a session returns `401`.

---

## Sequencing

```
WP-0 (done) ─► WP-1 ─┬─► WP-2 ─► WP-3 ─► WP-4
                     └─► WP-5 (independent, may run in parallel)
WP-1..4 ─► WP-6 ─► WP-7 ─► WP-8 ─► WP-9
```

**Internal pilot may proceed after WP-3.** Public exposure requires WP-8. Revenue requires WP-9.

## Escalate to Shane (only these)

1. WP-1: more than 3 `psql` subprocesses per request → invariant **I1** must be re-argued.
2. WP-9: the account-claim flow for a purchase whose email has no account is a product decision,
   not an engineering one.

Everything else in this document is decided. Proceed.
