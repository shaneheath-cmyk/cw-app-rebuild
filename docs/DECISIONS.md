# Decisions

## WP-1 relational runtime

The application now uses one `psql` process for each repository operation. Authentication is one process for session lookup and one for the requested operation, meeting the maximum of three processes per request. `004_drop_runtime_state.sql` is physically isolated under `db/pending/` so the migration runner cannot execute it.

## Spawn-budget decision

Measured login initially used four `psql` executions. I1 remains in force: password lookup stays separate so scrypt verification occurs in Node, while session pruning, session insertion, and audit recording are one stdin transaction. Login therefore uses two `psql` executions. Admin user creation uses one authenticated lookup and one insert-plus-audit transaction.

## Pilot and review boundary

WP-1a and WP-3 satisfy the internal-pilot gate. The service remains loopback-only and is not approved for public exposure, live Stripe, WP-8, WP-9, or applying `004_drop_runtime_state.sql`. WP-2 through WP-5 have builder verification but no independent post-implementation review; operate the pilot accordingly.

Production startup rejects a non-loopback bind host. Any network-exposure change therefore requires explicit code and configuration changes after separate authorization; no proxy, firewall, DNS, or listener change is permitted before then.

## Spawn-budget tripwire

The subprocess ceiling required batching in both session and abuse-control work. If WP-6 or WP-7 exposes a third distinct request path over three successful `psql` executions, stop and escalate I1 rather than adding further cross-concern batching.
