# Collective Writings standalone — adversarial review and deploy verdict

Reviewer: Claude (Opus 5) · Date: 2026-09-06 · Commit reviewed: `66c87ef`
Method: full read of all 865 lines of source, `npm test` (7/7 pass), plus a purpose-written
attack harness run against a live instance on the FileStore path
(`scratchpad/attack.mjs`, 16 probes A1–A16). Findings marked **[verified]** were reproduced;
findings marked **[by construction]** were established by reading code paths;
findings marked **[unconfirmed on node]** could not be executed on pax-node-01 (SSH key
rejected for `root@139.180.179.216`).

## Verdict

**Not ready to deploy publicly or to take money. Ready as a localhost-only internal pilot
once S1-1 and S1-3 are fixed.**

The application logic and the security boundaries are better than I expected — RBAC held under
attack, path traversal is genuinely neutralised, and Stripe webhook verification is correct. The
problem is not the app. **The problem is the storage layer.** What is described as "running on
PostgreSQL" is a single JSON document written by shelling out to `psql` with the entire
application state as one command-line argument. That design has a hard ceiling it has
already crossed in testing, and it leaks credentials into the process table.

---

## S1 — Deploy blockers

### S1-1. The PostgreSQL store fails permanently once state exceeds ~128 KB **[verified + unconfirmed on node]**

`PostgresStore.write()` (`src/lib/postgres.js:65`) serialises the *entire* application state and
passes it to `psql -c` as a single argv element. Linux caps one argument at
`MAX_ARG_STRLEN` = 32 pages = **131,072 bytes** (`execve(2)`); above that `spawn` fails with `E2BIG`.

- **[verified]** One deposit of a 200 KB text file produced a state blob of **208,134 bytes** —
  already 59% over the ceiling. (Probe A11.) The `parse` step stores up to 100 heading lines of
  arbitrary contributor-supplied text directly into the state document, with no per-line cap.
- **[verified]** Oversized argv makes `spawn` throw rather than degrade — reproduced locally
  (`ENAMETOOLONG` at 50 KB on Windows' lower limit).
- **[by construction]** `auditEvents`, `sessions`, `stripeEvents`, `deposits` and `orders` are
  never pruned. Even with no large deposits, ordinary use grows the blob monotonically —
  roughly 1,000 audit events is enough.
- **The failure is not graceful.** Once the blob is over the limit *every write fails* — logins,
  deposits, webhooks, user creation. Reads still work, so the app looks alive while being
  totally frozen. There is no in-app way to prune, because pruning is a write.

**Fix:** relational tables per entity (the "next slice" already identified in the handoff), or at
minimum stop passing state through argv — feed SQL to `psql` over **stdin**, and use a
parameterised client (`pg`) rather than a subprocess. Feeding via stdin removes the ceiling
immediately and is a ~10-line change; it does not fix the read-modify-write-whole-document
concurrency problem underneath.

### S1-2. Session tokens and password hashes are exposed in the process table **[by construction]**

The same argv path means every write puts the full state — including plaintext session tokens
and scrypt password hashes (**[verified]** present in state, probe A16) — on the `psql` command
line. On Linux `/proc/<pid>/cmdline` is world-readable, and `ps aux` shows it. Any local account
on pax-node-01 can harvest live session tokens by polling during writes. Fixed by the same
stdin/`pg` change as S1-1.

### S1-3. A missing or mistyped `DATABASE_URL` silently downgrades to a JSON file **[by construction]**

`createStore()` (`src/server.js:38`) is `config.databaseUrl ? Postgres : FileStore` with no
production guard. If the EnvironmentFile fails to load or the variable is typo'd, the service
starts successfully, serves a **synthetic seeded catalogue** ("Beneath the Black Trees", from
`emptyState` in `src/lib/store.js`), creates a *fresh* bootstrap admin, and writes all subsequent
data to `./data/cw-store.json` — invisibly diverging from the real database. `/api/health` would
report `"store":"file"`, but nothing fails.

**Fix:** fail closed — refuse to start when `NODE_ENV=production` and `DATABASE_URL` is unset.

### S1-4. Commerce cannot deliver what it sells **[verified]**

`applyStripeEvent` writes `orders` and `entitlements`; **nothing anywhere reads them**. There is
no download route, no asset delivery, no link from an entitlement to a user account. The app's
own UI says so: *"The checkout success page will not grant access by itself."*
(`src/public/app.js:61`). Switching `STRIPE_SECRET_KEY` to `sk_live_` would take real money and
deliver nothing. Keep Stripe unconfigured until fulfilment exists.

Related: the catalogue card hardcodes `money(1495)` for every work
(`src/public/app.js:38`) regardless of the product — the displayed price is a literal, not the
product's price.

---

## S2 — Must fix before any public exposure

| # | Finding | Evidence |
|---|---|---|
| S2-1 | **No login rate limiting or lockout.** 30 concurrent failed logins completed in 633 ms with no throttle, no delay, no lock. Offline-grade brute force against a live endpoint. | **[verified]** A5 |
| S2-2 | **Auth status codes are wrong and break re-auth.** Invalid credentials → `422`. Expired/invalid session → `403`, not `401`. A client cannot distinguish "logged out" from "not permitted", so it will never redirect to login. | **[verified]** A2, A5 |
| S2-3 | **A malformed cookie returns `422 {"error":"URI malformed"}`.** `readCookies` calls `decodeURIComponent` unguarded (`src/lib/auth.js:32`); a single stray `%` in any cookie on the domain hard-fails every authenticated request. Should be treated as "no session". | **[verified]** A1 |
| S2-4 | **Session cookies will ship without `Secure`.** `secureCookie` is derived from `CW_PUBLIC_ORIGIN`, which the unit file pins to `http://127.0.0.1:4173` (`deploy/cw-app.service:13`). Put TLS in front and the flag is still absent — and Stripe's `success_url`/`cancel_url` would point at 127.0.0.1. | **[by construction]** |
| S2-5 | **No TLS, no reverse proxy, no HSTS.** Known and stated in the handoff; listing for completeness. | **[verified]** A15 |
| S2-6 | **`/api/checkout` is unauthenticated and unthrottled.** Reachable with no session (returned 422 only because Stripe is unconfigured). With live keys, anyone can mint unlimited Stripe Checkout sessions against your account. | **[verified]** A3 |
| S2-7 | **No retention or pruning anywhere.** Sessions are pruned only opportunistically on sign-in; audit events, Stripe events, deposits and orders grow forever. This is what eventually detonates S1-1. | **[by construction]** |

---

## S3 — Should fix

- **`sqlLiteral` escapes only `'`** (`postgres.js:36`). Safe only while `standard_conforming_strings`
  is `on` (the default). Fragile for a value that is 100% attacker-influenced content.
- **`sslmode` is silently dropped.** `connectionEnvironment` rebuilds the connection from URL parts
  and discards query parameters — a remote `DATABASE_URL` with `?sslmode=require` would connect
  **unencrypted**. Currently local-socket only, so latent.
- **`FileStore.read()` assigns shared `emptyState` arrays by reference** (`store.js:47`), so a
  mutation can contaminate module-level state across requests.
- **`dist/` is built but never served.** Production runs `node src/server.js`, which serves
  `src/public` (`server.js:42`). Editing `dist/` silently does nothing.
- **`verifyPostgresRuntime` is imported into `server.js` and never called** — the server does not
  verify its database identity at boot; only the migration script does.
- **One `psql` process spawned per read *and* per write.** Every API request forks a subprocess.
- **Orphaned artefacts:** `createDeposit` writes the file to disk before the store update; if the
  update throws, the file is left behind with no record.
- **`parseRetrievedDeposit` re-finds the deposit without a null check** (`custody.js:78`) — a
  TypeError if the deposit vanishes between read and update.

---

## What is genuinely sound

Worth recording, because it is the majority of the code:

- **RBAC held.** A contributor could not read `/api/operations`, could not create a system-admin,
  and could not retrieve their own deposit past the role boundary. No escalation found. **[verified A8, A12]**
- **Path traversal is neutralised.** `../../../../evil.txt` was stored as `.._.._.._.._evil.txt`;
  five encoded traversal variants against the static handler all returned 404. **[verified A4, A10]**
- **Stripe webhook verification is correct** — timestamp tolerance window, `v1` candidate list,
  length check before `timingSafeEqual`, and idempotency by event id.
- **scrypt password hashing** with a 14-character minimum and per-user salt.
- **Client output is HTML-escaped**; CSP, `frame-ancestors 'none'`, `nosniff`, and
  `X-Frame-Options` are set on every response; the service binds to `127.0.0.1` and the unit file
  uses `ProtectSystem=strict`, `NoNewPrivileges`, `PrivateTmp`.
- **The tests are real**, not tautological, and all 7 pass.

---

## Recommended order of work

1. **Replace the argv path** — SQL over stdin, or the `pg` client with real parameters. (S1-1, S1-2)
2. **Fail closed on missing `DATABASE_URL` in production.** (S1-3)
3. Fix auth status codes and the cookie-decode crash. (S2-2, S2-3)
4. Add login rate limiting; authenticate and throttle `/api/checkout`. (S2-1, S2-6)
5. TLS + reverse proxy, then set `CW_PUBLIC_ORIGIN` to the real https origin. (S2-4, S2-5)
6. Relational repositories, DB-backed sessions, RLS — the slice already planned. Retention policy
   for audit and Stripe events falls out of this.
7. Only then: fulfilment/delivery, then live Stripe. (S1-4)

## Outstanding verification

`MAX_ARG_STRLEN` on pax-node-01 was **not** confirmed on the node — SSH to
`root@139.180.179.216` was refused (publickey). The 131,072-byte figure is the documented Linux
kernel constant, and the failure *mode* was reproduced locally. Confirm on the node with:

```bash
systemctl is-active cw-app.service && /bin/true "$(head -c 208134 /dev/zero | tr '\0' x)" ; echo "exit=$?"
```
