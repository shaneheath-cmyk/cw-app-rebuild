# Collective Writings: Condensed Claude Test Package

## Scope

Review commit containing the PostgreSQL runtime adapter and Pax Node 1 deployment unit. This is an adversarial test package, not a production sign-off request.

## Verified claims to reproduce

1. `npm run check:legacy-free`, `npm test`, and `npm run build` pass without installing application dependencies.
2. With no `DATABASE_URL`, the service uses the ignored local file store.
3. With a valid `DATABASE_URL`, `PostgresStore` requires `cw_runtime_state`, reads/writes state through PostgreSQL, and `/api/health` reports `store: postgresql`.
4. `npm run db:migrate` records ordered migrations in `cw_schema_migration`; it baselines the already-applied `001_initial.sql` only when that original schema is present and migration history is empty.
5. The node service is loopback-only, starts only after its migrations pass, and uses a systemd `EnvironmentFile` rather than committed secrets.
6. Public checkout cannot run until an `sk_live_` key and approved immutable `price_...` ID are present. No real Stripe call is authorised by this package.

## Exact high-risk targets

- `src/lib/postgres.js`: connection-string parsing, `psql` invocation, JSON SQL literal escaping, error redaction, command-length limits, process environment exposure, and one-process update serialization.
- `scripts/db-migrate.mjs`: baseline detection, migration ordering, transaction semantics, replay safety, and partial-failure recovery.
- `src/lib/auth.js` and `src/server.js`: password/session handling, role boundaries, bootstrap account lifecycle, CSRF/rate-limit gaps, static-file routing, and protected Studio redirect.
- `src/lib/custody.js`: staging paths, filename rules, source immutability, parser proposal limits, and agent/human approval boundaries.
- `src/lib/stripe.js`: live/test separation, server-owned price allow-list, webhook signature/replay handling, subscription cancellation/refund gaps, and entitlement repeat safety.

## Known limitations to classify, not ignore

- `cw_runtime_state` is a transactional compatibility document while the current route layer still expects an aggregate state object. It proves live PostgreSQL runtime use, but should be replaced with direct repository operations against the relational tables before high-concurrency production use.
- No PostgreSQL row-level security policy is yet installed; app-role ownership and loopback-only deployment reduce exposure but do not replace RLS.
- No rate limiting, password reset flow, MFA, malware scanning, backup/restore rehearsal, TLS/reverse proxy, public deployment, Stripe activation, KDP listing verification, or full reference-data migration is in scope.
- The node-only bootstrap administrator is generated into root-owned service configuration; its credential must be rotated through a controlled operator process before any non-loopback release.

## Required audit output

Return severity-ranked findings with file/line references, reproducible commands, a conclusion for each verified claim, and a separate list of production blockers. Do not treat passing local tests or a node-side schema as revenue-live evidence.
