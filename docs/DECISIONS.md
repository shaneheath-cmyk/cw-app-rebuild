# Decisions

## WP-1 relational runtime

The application now uses one `psql` process for each repository operation. Authentication is one process for session lookup and one for the requested operation, meeting the maximum of three processes per request. `004_drop_runtime_state.sql` is intentionally excluded from the migration runner until WP-7 production stability sign-off.

## Spawn-budget decision

Measured login initially used four `psql` executions. I1 remains in force: password lookup stays separate so scrypt verification occurs in Node, while session pruning, session insertion, and audit recording are one stdin transaction. Login therefore uses two `psql` executions. Admin user creation uses one authenticated lookup and one insert-plus-audit transaction.
