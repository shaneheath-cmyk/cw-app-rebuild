# Codex final instruction — WP-1a through WP-9

Issued 2026-09-07 · Baseline `485ac87` on `remediation/wp-0-postgres-transport`
**This is the last instruction I can issue this cycle** (review budget exhausted; resets
Wednesday). It is written to be executed without me. Where I would normally have attacked the
build myself, §2 makes that your job and specifies exactly what to run.

Read with: `audit/CLAUDE-ADVERSARIAL-VERDICT.md` (findings), `audit/WBS-CODEX-REMEDIATION.md`
(plan; WP-1 section superseded), `audit/CODEX-WP1-INSTRUCTION.md` (conventions — §2 decisions,
§4 SQL emitters, §6 concurrency pattern all still bind).

---

## 0. Operating rules (unchanged, restated because they now run unsupervised)

- **Do not stop to ask.** Resolve forks by preserving the invariants, record in
  `docs/DECISIONS.md`, continue. Only the two named escalations halt you.
- **Invariants:** I1 zero runtime dependencies · I2 SQL on stdin, nothing sensitive in argv ·
  I3 no unbounded array serialised as one value · I4 fail closed · I5 loopback binding until WP-8.
- **Never weaken or delete a test to go green.** Fix the code.
- **A skipped test is not a passing test.** Any suite that skips its integration cases must print
  a final line `INTEGRATION COVERAGE: SKIPPED` and exit non-zero in CI.
- One commit per package, `WP-<n> <imperative>`. Ends green on
  `npm test && npm run check:legacy-free && npm run build`.

---

## 1. WP-1a — Regressions introduced by WP-1 (do this first, before WP-2)

**1a-1 · `/api/operations` silently lost deposits.** `src/server.js:85` returns a hardcoded
`deposits: []` on the PostgreSQL path. There is no `listDeposits` repository method. The
custodian operations view — the primary intake queue — now returns an empty list in production
while the development path still returns real data. Add `deposits.listForOperations(limit)`
(ordered `created_at desc`, explicit limit, joined to its parse row) and wire it. **A test must
assert a staged deposit appears in `/api/operations`.** It did not regress silently by accident:
nothing asserted it.

**1a-2 · The two store paths have drifted.** `src/server.js:80` and `:85` branch on
`store.listWorks ?` and `store.listOpenTasks ?`. This is exactly what the WP-1 instruction
forbade: development and production now execute different code. Every test you run locally
against `FileStore` proves nothing about the deployed path, which is how 1a-1 escaped.

Fix: define the repository interface once and make `FileStore` implement **all** of it —
`listWorks`, `listOpenTasks`, `listRecentAuditEvents(limit)`, `listForOperations(limit)`.
Delete every `store.<method> ?` conditional from `server.js`. Add a test that asserts both
implementations expose an identical method set:
`assert.deepEqual(Object.keys(fileStore).sort(), Object.keys(repositories).sort())`.
**No feature detection at call sites, ever.** If a store cannot satisfy the interface it is not
a store.

**1a-3 · Close the integration gap.** The concurrency and duplicate tests from
`CODEX-WP1-INSTRUCTION.md §7` are still unrun. They are the acceptance criteria for the package
you reported complete. Provision a local PostgreSQL (or point `DATABASE_URL` at a scratch
database on the node) and run them. Until they have run once and passed, **WP-1 is not done** —
the race condition it existed to fix is unverified.

---

## 2. The adversarial suite — build it, then run it after every package

I attacked the build by hand and found the blockers in `CLAUDE-ADVERSARIAL-VERDICT.md`. That
harness was throwaway. Make it permanent: `test/adversarial.test.js`, run by `npm test`.

Port these probes (originals in the verdict doc, §"What is genuinely sound" and the S1/S2 tables).
**Each must assert, not merely print** — a probe that logs a status without asserting is theatre:

| Probe | Assertion |
|---|---|
| Malformed cookie `cw_session=%` | `401`, never `422`, never a decode error in the body |
| Absent / bogus / expired session | all `401`; only an authenticated-but-unpermitted actor gets `403` |
| Invalid credentials | `401` |
| Contributor → `/api/operations` | `403` |
| Contributor → `POST /api/admin/users` with `roles:['system-admin']` | `403`, and no user created |
| Deposit filename `../../../../evil.txt` | stored basename contains no separator; nothing written outside `01-staging/<id>/` |
| Five encoded traversal variants on the static handler | all `404`, no file content in the body |
| Unauthenticated `POST /api/checkout` | `401` (after WP-4) |
| Webhook body over the limit | `413`, rejected **before** the HMAC is computed |
| Non-JSON body on every POST | `400` |
| 6th failed login in the window | `429` with `Retry-After` (after WP-4) |
| Session row vs cookie | stored value ≠ cookie value |
| Every response | CSP, `nosniff`, `frame-ancestors 'none'` present |

**Add a positive control to each destructive probe.** A traversal test that would pass against a
server that serves nothing proves nothing — assert a legitimate file *does* load in the same test.
This is the discipline that caught the WP-0 evidence gap: *"the change broke nothing"* and
*"the change did what it claimed"* are separate propositions needing separate evidence.

---

## 3. WP-2 — Sessions (storage landed in WP-1; policy did not)

- Rotate the token on every successful sign-in: issue new, delete the presenting row, same transaction.
- Enforce expiry in the `where` clause, never in JavaScript.
- Delete expired rows on sign-in; full sweep belongs to WP-6.
- **Test:** a token captured before rotation is rejected after it.

## 4. WP-3 — Response semantics

Split `currentActor` into `authenticate()` (→ `401 Authentication required.`) and
`authorise(user, permitted)` (→ `403 Forbidden.`). Conflating them is why an expired session
returns `403` and no client can ever redirect to login.

Guard `decodeURIComponent` per cookie component in `readCookies` (`src/lib/auth.js:32`); an
undecodable cookie is "no session", not an error.

Replace the status ladder at `server.js:~130` with an explicit error→status map:
`401` auth · `403` forbidden · `400` malformed JSON · `404` missing · `409` duplicate deposit
(the `unique (sha256)` violation) · `413` oversize · `429` throttled · `422` domain-rule refusal.
**Never return a raw `error.message` for a status the map does not know** — return
`Request failed.` and log the detail server-side. Today an internal error string reaches the client.

## 5. WP-4 — Abuse controls

- `cw_login_attempt` table (survives restart; an in-memory map does not). 5 failures per
  email **and** per source IP in 15 minutes → `429` + `Retry-After: 900`, regardless of whether
  the credential was correct. Success clears the email counter.
- `/api/checkout`: require a session; 10 per session per hour.
- Webhook body limit 1 MB, rejected on `content-length` **before** reading the body.

## 6. WP-5 — Correctness defects

1. `src/public/app.js:38` renders `money(1495)` for every work — read the real price. Do not ship
   a page displaying a price the checkout will not charge.
2. `src/lib/store.js` — `structuredClone` the `emptyState` arrays; they are currently shared by
   reference across requests.
3. Cap `parse.headings` at 100 entries **and 200 characters each** — attacker-controlled text
   into durable storage with no bound.
4. Call `verifyPostgresRuntime` during `initialise()` and log the identity at boot; it is
   imported and unused.
5. `createDeposit` — delete the on-disk artefact if the transaction fails, then rethrow.
6. Serve `dist/` in production (or delete the build step). Assert the served directory exists at
   boot. Today `dist/` is built and `src/public` is served.

## 7. WP-6 — Retention

`scripts/retention.mjs` + a systemd timer, **not** a `setInterval` in the web process.
`audit_event` 400 days, archived as monthly JSONL under `${CW_STORAGE_ROOT}/06-archive/audit/`
before deletion — audit history is evidentiary, archive it, never silently discard.
`commerce_event` 90 days. `user_session` on expiry. Idempotent; `--dry-run` prints counts and
writes nothing.

## 8. WP-7 — Connection and config hardening

- `connectionEnvironment` drops URL query parameters, so `?sslmode=require` is silently ignored
  and a remote database would connect **unencrypted**. Pass `PGSSLMODE` through; default
  `require` for any non-loopback host; refuse to start on non-loopback + `sslmode=disable`.
- Validate all production config at boot, reporting **every** failure at once, not the first.
- Apply `004_drop_runtime_state.sql` only once WP-1a's integration tests have passed in production.
- Add `MemoryDenyWriteExecute`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`,
  `PrivateDevices`, `ProtectKernelTunables`, `ProtectControlGroups` to the unit file.

## 9. WP-8 — TLS

Reverse proxy terminating TLS to `127.0.0.1:4173`; app keeps its loopback binding. HSTS
`max-age=63072000; includeSubDomains`. **`CW_PUBLIC_ORIGIN` must become the real `https://`
origin** — it currently pins `http://127.0.0.1:4173`, which strips `Secure` from the session
cookie (the flag is derived from that string) and would point Stripe's `success_url` at
localhost. Make a non-`https://` origin fatal under `NODE_ENV=production`. Commit the proxy
config to `deploy/`.

## 10. WP-9 — Fulfilment · **gate for live Stripe**

**Do not set `sk_live_` until this is complete.** Entitlements are written and read by nothing;
there is no delivery route. Going live now means taking money and delivering nothing.

Link `entitlement` to `app_user`, resolving on `customer_details.email`; where no account exists,
create a pending entitlement and a claim flow — **do not auto-create a password-less account**.
Add an authenticated delivery route streaming from `05-release`, authorised by an active
entitlement, never exposing a storage path. Audit every delivery. Replace the placeholder
"My Library" copy at `src/public/app.js:61`.

**Test:** webhook → entitlement → authenticated download; the same download without the
entitlement is `403`, without a session is `401`.

---

## 11. Gates

- **Internal pilot:** after WP-1a + WP-3.
- **Public exposure:** after WP-8.
- **Revenue:** after WP-9. No exceptions.

## 12. Escalate to Shane — only these

1. More than 3 `psql` spawns per request → invariant I1 must be re-argued.
2. WP-9's account-claim flow for a purchase whose email has no account — product decision.
3. Any finding that would change a gate above.

## 13. Report format on completion

Per package: the acceptance commands **with their output**, the specific assertion that proves
the fix works (not that the service restarted), and anything you could not verify — named as
unverified. `/api/health` returning `ok` is evidence the process is alive and nothing more.
