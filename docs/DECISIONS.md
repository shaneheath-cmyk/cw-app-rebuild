# Decisions

## WP-1 relational runtime

The application now uses one `psql` process for each repository operation. Authentication is one process for session lookup and one for the requested operation, meeting the maximum of three processes per request. `004_drop_runtime_state.sql` is intentionally excluded from the migration runner until WP-7 production stability sign-off.
